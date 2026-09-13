import copy
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]

def module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / (name + '.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value

builder = module('build_prizepicks_normalized_v6')
slices = module('build_hierarchy_slices')
DAY = dt.date(2026, 9, 13)


def prop(**overrides):
    return {'gameId': '123', 'player': 'Fixture Quarterback', 'sport': 'NFL',
        'Team': 'Chicago Bears', 'Opponent': 'Detroit Lions', 'stat': 'Pass Yards',
        'line': 229.5, 'oddsType': 'standard', 'startTime': '09/13/26 12:00 PM CST',
        'startTimeIso': '2026-09-13T17:00:00Z', 'rank': 4, **overrides}


class HierarchyIntegrity(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.data = Path(self.temp.name)
        self.env = patch.dict(os.environ, {}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)

    def write_master(self, props=None, **overrides):
        rows = [prop()] if props is None else props
        value = {'scrapedAt': '2026-09-13T12:00:00Z', 'scrapedDate': 'original text',
            'totalProps': len(rows), 'props': rows, **overrides}
        raw = (json.dumps(value, indent=3) + '\n').encode()
        (self.data / 'prizepicks.json').write_bytes(raw)
        return raw

    def build(self):
        builder.build(self.data, DAY)
        with patch.object(slices, 'DATA_DIR', self.data):
            slices.main()

    def rows(self):
        return json.loads((self.data / 'hierarchy/current_day/props.json').read_text())

    def test_master_wins_over_conflicting_derivative(self):
        self.write_master()
        (self.data / 'prizepicks-nfl-today-top-50.json').write_text(json.dumps({'props': [prop(line=228.5)]}))
        self.build()
        self.assertEqual(self.rows()[0]['line'], 229.5)

    def test_exact_bytes_and_pointer_lineage(self):
        raw = self.write_master()
        self.build()
        row = self.rows()[0]
        self.assertEqual(row['sourcePayloadHash'], hashlib.sha256(raw).hexdigest())
        self.assertEqual(row['sourcePointer'], '/props/0')
        self.assertEqual(row['sourceScrapedAt'], '2026-09-13T12:00:00Z')
        self.assertIsNone(row['nativeProjectionId'])
        self.assertEqual(row['sourceRecordIdKind'], 'mirror-json-pointer')

    def test_native_ids_status_rank_preserved(self):
        self.write_master([prop(projectionId='p-17', playerId='u-9', status='pre_game')])
        self.build()
        row = self.rows()[0]
        self.assertEqual((row['nativeProjectionId'], row['nativePlayerId'], row['providerStatus'], row['rank']), ('p-17', 'u-9', 'pre_game', 4))

    def test_obsolete_sport_and_game_slices_removed_archive_kept(self):
        self.write_master()
        self.build()
        branch = self.data / 'hierarchy/current_day'
        stale = branch / 'nba/props-index.json'
        stale.parent.mkdir()
        stale.write_text('{"old":true}')
        stale_game = branch / 'nfl/props-by-game/obsolete.json'
        stale_game.write_text('[]')
        archive = self.data / 'hierarchy/archive/2026-06-13/nba.json'
        archive.parent.mkdir(parents=True)
        archive.write_text('preserve')
        self.build()
        self.assertFalse(stale.exists())
        self.assertFalse(stale_game.exists())
        self.assertEqual(archive.read_text(), 'preserve')

    def test_empty_master_removes_old_sports(self):
        self.write_master(); self.build()
        self.write_master([]); self.build()
        self.assertFalse((self.data / 'hierarchy/current_day/nfl').exists())
        self.assertEqual(self.rows(), [])

    def test_invalid_count_does_not_overwrite_last_good_build(self):
        self.write_master(); self.build()
        before = self.rows()
        self.write_master(totalProps=500)
        with self.assertRaises(ValueError): self.build()
        self.assertEqual(self.rows(), before)

    def test_missing_timestamp_rejected(self):
        self.write_master(scrapedAt=None)
        with self.assertRaises(ValueError): self.build()

    def test_remote_override_rejected(self):
        self.write_master()
        with patch.dict(os.environ, {'DATA_BASE_URL': 'https://other.invalid/data'}):
            with self.assertRaises(ValueError): self.build()

    def test_iso_time_beats_wrong_legacy_label_and_chicago_midnight(self):
        self.write_master([prop(startTime='01/01/99 12:00 PM CST', startTimeIso='2026-09-14T04:59:00Z')])
        self.build()
        self.assertEqual(self.rows()[0]['dayBranch'], 'current_day')
        game = json.loads((self.data / 'hierarchy/current_day/games.json').read_text())[0]
        self.assertEqual(game['startTimeIso'], '2026-09-13T23:59:00-05:00')

    def test_dst_ambiguous_or_missing_offset_rejected(self):
        with self.assertRaises(ValueError): builder.parse_time('11/01/26 01:30 AM CST')
        with self.assertRaises(ValueError): builder.parse_time('03/08/26 02:30 AM CST')
        with self.assertRaises(ValueError): builder.instant('2026-09-13T12:00:00')

    def test_conflicting_lines_retained_and_flagged(self):
        self.write_master([prop(line=229.5), prop(line=228.5)])
        self.build()
        self.assertEqual({r['line'] for r in self.rows()}, {228.5, 229.5})
        self.assertTrue(all(r['sourceConflict'] for r in self.rows()))

    def test_native_game_time_separate_from_projection_lock_time(self):
        self.write_master([prop(startTimeIso='2026-09-13T17:05:00Z')], included=[{
            'id':'123', 'type':'game', 'attributes':{'start_time':'2026-09-13T17:00:00Z'}}])
        self.build()
        row = self.rows()[0]
        self.assertEqual(row['startTimeIso'], '2026-09-13T12:05:00-05:00')
        self.assertEqual(row['eventStartTimeIso'], '2026-09-13T17:00:00+00:00')
        self.assertTrue(row['eventTimeVerified'])
        self.assertEqual(row['eventTimeSources'][0]['sourcePointer'], '/included/0/attributes/start_time')
        self.assertFalse(row['sourceEventConflict'])
        index = json.loads((self.data / 'hierarchy/current_day/nfl/props-index.json').read_text())
        self.assertEqual(index['games'][0]['startTimeIso'], '2026-09-13T12:00:00-05:00')
        self.assertTrue(index['games'][0]['eventTimeVerified'])

    def test_conflicting_native_game_times_remain_unverified(self):
        self.write_master(included=[{'id':'123','type':'game','attributes':{'start_time':t}}
            for t in ['2026-09-13T17:00:00Z','2026-09-13T18:00:00Z']])
        self.build()
        self.assertFalse(self.rows()[0]['eventTimeVerified'])
        self.assertIsNone(self.rows()[0]['eventStartTimeIso'])
        self.assertEqual(len(self.rows()[0]['eventTimeSources']),2)

    def test_nonfinite_line_rejected(self):
        self.write_master([prop(line='NaN')])
        with self.assertRaises(ValueError): self.build()

    def test_missing_branch_fails(self):
        with patch.object(slices, 'DATA_DIR', self.data):
            with self.assertRaises(FileNotFoundError): slices.main()

    def test_path_traversal_rejected(self):
        self.write_master([prop(gameId='../outside')])
        with self.assertRaises(ValueError): self.build()

    def test_legacy_completeness_not_claimed(self):
        self.write_master(); self.build()
        receipt = json.loads((self.data / 'hierarchy/current_day/provenance.json').read_text())
        self.assertEqual(receipt['completeness'], 'legacy-unverified')

    def test_inconsistent_acquisition_rejected_before_slice_cleanup(self):
        self.write_master(); self.build()
        target = self.data / 'hierarchy/current_day/props.json'
        data = self.rows(); data[0]['sourcePayloadHash'] = 'other'; target.write_text(json.dumps(data))
        with patch.object(slices, 'DATA_DIR', self.data):
            with self.assertRaises(ValueError): slices.main()
        self.assertTrue((self.data / 'hierarchy/current_day/nfl/props-index.json').exists())


if __name__ == '__main__': unittest.main()
