"""Build compatible hierarchy tables from ONE local mirror acquisition.

Derived/team/top-N files and remote repositories cannot supply alternative lines.
"""
import datetime as dt
import hashlib
import json
import os
from collections import defaultdict
from decimal import Decimal, InvalidOperation
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
BASE_PATH = ROOT / 'data' / 'hierarchy'
CST = ZoneInfo('America/Chicago')
SAFE_ODDSTYPE = 'standard'


def instant(value):
    result = dt.datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('timestamp requires an explicit UTC offset')
    return result


def get_day_branch(value, today=None):
    today = today or dt.datetime.now(CST).date()
    date = value.astimezone(CST).date()
    return {today: 'current_day', today + dt.timedelta(days=1): 'tomorrow'}.get(date)


def parse_time(value):
    # Legacy labels said CST even in summer. Use Chicago wall time, but never
    # guess an instant during an ambiguous/nonexistent DST wall time.
    plain = str(value).removesuffix(' CST').removesuffix(' CDT')
    naive = dt.datetime.strptime(plain, '%m/%d/%y %I:%M %p')
    first, second = (naive.replace(tzinfo=CST, fold=n) for n in (0, 1))
    if first.utcoffset() != second.utcoffset():
        raise ValueError('ambiguous or nonexistent Chicago time requires startTimeIso')
    return first


def clean_key(value):
    return str(value).lower().replace(' ', '-')


def make_player_id(team, player):
    digest = hashlib.sha1(f'{team}_{player}'.encode()).hexdigest()[:8]
    return f'{clean_key(team)}_{clean_key(player)}_{digest}'


def fetch_props_sources(data_dir=None):
    """Native mirror rows with exact input-byte and JSON-pointer lineage."""
    if os.environ.get('DATA_BASE_URL'):
        raise ValueError('DATA_BASE_URL is unsupported: use this acquisition local master')
    source = Path(data_dir or ROOT / 'data') / 'prizepicks.json'
    raw = source.read_bytes()
    envelope = json.loads(raw, parse_float=Decimal)
    if not isinstance(envelope, dict) or not isinstance(envelope.get('props'), list):
        raise ValueError('master envelope must contain a props array')
    if type(envelope.get('totalProps')) is not int or envelope['totalProps'] != len(envelope['props']):
        raise ValueError('master totalProps does not match props length')
    instant(envelope.get('scrapedAt'))
    digest = hashlib.sha256(raw).hexdigest()
    outcomes = envelope.get('leagueResults', [])
    if not isinstance(outcomes, list):
        raise ValueError('leagueResults must be an array')
    game_observations = defaultdict(list)
    for index, record in enumerate(envelope.get('included', [])):
        if record.get('type') == 'game' and record.get('attributes', {}).get('start_time'):
            game_observations[str(record['id'])].append({
                'startTimeIso': instant(record['attributes']['start_time']).isoformat(),
                'sourcePointer': f'/included/{index}/attributes/start_time'})
    props = []
    for index, row in enumerate(envelope['props']):
        if not isinstance(row, dict):
            raise ValueError(f'master /props/{index} is not an object')
        pointer = f'/props/{index}'
        game_sources = game_observations.get(str(row.get('gameId')), [])
        game_times = {instant(g['startTimeIso']).astimezone(dt.timezone.utc) for g in game_sources}
        game_time = next(iter(game_times)).isoformat() if len(game_times) == 1 else None
        props.append({**row, '_lineage': {
            'sourcePath': '/data/prizepicks.json', 'sourcePointer': pointer,
            'sourcePayloadHash': digest, 'sourceScrapedAt': envelope['scrapedAt'],
            'sourceScrapedDate': envelope.get('scrapedDate'),
            'sourceRecordId': row.get('projectionId') or f'sha256:{digest}#{pointer}',
            'sourceRecordIdKind': 'prizepicks-projection' if row.get('projectionId') else 'mirror-json-pointer',
            'providerFetchedAt': row.get('providerFetchedAt'),
            'eventStartTimeIso': game_time,
            'eventTimeSources': game_sources,
            'eventTimeVerified': len(game_times) == 1,
        }})
    return props, {
        'schemaVersion': '1.0', 'sourcePath': '/data/prizepicks.json',
        'sourcePayloadHash': digest, 'sourceScrapedAt': envelope['scrapedAt'],
        'sourceScrapedDate': envelope.get('scrapedDate'), 'inputPropCount': len(props),
        'leagueResults': outcomes, 'completeness': 'reported' if outcomes else 'legacy-unverified',
    }


def normalize_props(props, today=None):
    games, teams, players, props_out = {}, {}, {}, []
    slates = defaultdict(lambda: {'gameIds': [], 'totalProps': 0})
    market_lines = defaultdict(set)
    for row in props:
        if str(row.get('oddsType', '')).lower() != SAFE_ODDSTYPE:
            continue
        value = instant(row['startTimeIso']) if row.get('startTimeIso') else parse_time(row['startTime'])
        value = value.astimezone(CST)
        event = instant(row['_lineage']['eventStartTimeIso']).astimezone(CST) if row.get('_lineage', {}).get('eventTimeVerified') else value
        branch = get_day_branch(event, today)
        if branch is None:
            continue
        required = ('gameId', 'sport', 'Team', 'Opponent', 'player', 'stat')
        if any(not isinstance(row.get(k), str) or not row[k].strip() for k in required):
            raise ValueError('in-scope prop lacks required identity fields')
        gid, sport, team, opponent, player = (row[k] for k in required[:5])
        try:
            line_decimal = Decimal(str(row['line']))
        except (InvalidOperation, KeyError, ValueError):
            raise ValueError('line must be finite decimal data') from None
        if isinstance(row.get('line'), bool) or not line_decimal.is_finite():
            raise ValueError('line must be finite numeric data')
        # Emit decimal strings so every downstream JSON parser can preserve
        # the value. Comparison uses Decimal, so 229.50 and 229.5 agree.
        line, slate = str(row['line']), 'Early' if event.hour < 15 else 'Late'
        if gid in games and (games[gid]['sport'], games[gid]['dayBranch']) != (sport, branch):
            raise ValueError(f'cross-sport or cross-day gameId collision: {gid}')
        if gid not in games:
            games[gid] = {'gameId': gid, 'sport': sport, 'startTime': event.strftime('%m/%d/%y %I:%M %p %Z'),
                'startTimeIso': event.isoformat(), 'teams': [team, opponent], 'slate': slate, 'dayBranch': branch,
                'startTimeObservations': [], 'teamPairObservations': [], 'sourceEventConflict': False,
                'eventTimeVerified': bool(row.get('_lineage', {}).get('eventTimeVerified')),
                'startTimeSelectionRule': 'linked-provider-game' if row.get('_lineage', {}).get('eventTimeVerified') else 'earliest-observed-projection-time-unverified'}
        game = games[gid]
        game['eventTimeVerified'] = game['eventTimeVerified'] and bool(row.get('_lineage', {}).get('eventTimeVerified'))
        pair = sorted([team, opponent])
        if pair not in game['teamPairObservations']:
            game['teamPairObservations'].append(pair)
        if event.isoformat() not in game['startTimeObservations']:
            game['startTimeObservations'].append(event.isoformat())
            game['startTimeObservations'].sort()
        if event < instant(game['startTimeIso']):
            game['startTimeIso'] = event.isoformat()
            game['startTime'] = event.strftime('%m/%d/%y %I:%M %p %Z')
            game['slate'] = slate
        game['sourceEventConflict'] = len(game['startTimeObservations']) > 1 or len(game['teamPairObservations']) > 1
        game['teams'] = sorted({name for pair in game['teamPairObservations'] for name in pair})
        for name in (team, opponent):
            code = clean_key(name)
            if code in teams and teams[code]['sport'] != sport:
                raise ValueError(f'cross-sport team identity collision: {code}')
            teams.setdefault(code, {'teamCode': code, 'teamName': name, 'sport': sport})
        pid = make_player_id(team, player)
        players.setdefault(pid, {'playerId': pid, 'playerName': player,
            'teamCode': clean_key(team), 'sport': sport, 'nativePlayerId': row.get('playerId')})
        key = (gid, pid, row['stat'], SAFE_ODDSTYPE)
        market_lines[key].add(line_decimal)
        props_out.append({'propId': f"{gid}_{pid}_{clean_key(row['stat'])}",
            'gameId': gid, 'playerId': pid, 'stat': row['stat'], 'line': line,
            'teamCode': clean_key(team), 'opponentCode': clean_key(opponent),
            'oddsType': SAFE_ODDSTYPE, 'sport': sport, 'startTime': row.get('startTime'),
            'startTimeIso': value.isoformat(), 'dayBranch': branch,
            'rank': row.get('rank'), 'nativeProjectionId': row.get('projectionId'),
            'nativePlayerId': row.get('playerId'), 'providerStatus': row.get('status'),
            **row.get('_lineage', {})})
    for game in games.values():
        slates[(game['dayBranch'], game['slate'])]['gameIds'].append(game['gameId'])
    for row in props_out:
        row['sourceConflict'] = len(market_lines[(row['gameId'], row['playerId'], row['stat'], row['oddsType'])]) > 1
        row['sourceEventConflict'] = games[row['gameId']]['sourceEventConflict']
        slates[(row['dayBranch'], games[row['gameId']]['slate'])]['totalProps'] += 1
    return games, teams, players, props_out, [{'dayBranch': b, 'slate': s, **v} for (b, s), v in slates.items()]


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False,
        default=lambda item: str(item) if isinstance(item, Decimal) else _unsupported_json(item)) + '\n')


def _unsupported_json(item):
    raise TypeError(f'Unsupported JSON value: {type(item).__name__}')


def build(data_dir=None, today=None):
    data_dir = Path(data_dir or ROOT / 'data')
    today = today or dt.datetime.now(CST).date()
    props, provenance = fetch_props_sources(data_dir)
    games, teams, players, normalized, slates = normalize_props(props, today)
    # Validate everything before output. CI publishes the branches in one commit.
    for branch, date in (('current_day', today), ('tomorrow', today + dt.timedelta(days=1))):
        day_games = [g for g in games.values() if g['dayBranch'] == branch]
        day_props = [p for p in normalized if p['dayBranch'] == branch]
        team_ids = {clean_key(t) for g in day_games for t in g['teams']}
        player_ids = {p['playerId'] for p in day_props}
        root = data_dir / 'hierarchy' / branch
        for name, rows in {'games': day_games, 'props': day_props,
                'teams': [v for k, v in teams.items() if k in team_ids],
                'players': [v for k, v in players.items() if k in player_ids],
                'slates': [s for s in slates if s['dayBranch'] == branch]}.items():
            write_json(root / f'{name}.json', rows)
        write_json(root / 'provenance.json', {**provenance, 'dayBranch': branch,
            'observedDate': date.isoformat(), 'timezone': 'America/Chicago',
            'generatedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
            'propCount': len(day_props), 'gameCount': len(day_games),
            'conflictCount': sum(p['sourceConflict'] for p in day_props)})
    return len(normalized)


if __name__ == '__main__':
    print(f'Normalized {build()} props from the local master acquisition')
