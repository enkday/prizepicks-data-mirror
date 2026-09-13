const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const {parseProjection, parseProjectionPayload, parseLeagueProjections,
  assertCompleteProjectionPayload, getCstStartFields} = require('../scraper');

const projection = {
  type: 'projection', id: 'projection-17',
  attributes: {odds_type: 'standard', stat_type: 'Pass Yards', status: 'pre_game',
    line_score: '229.5', start_time: '2026-09-13T17:05:00Z', rank: 3},
  relationships: {new_player: {data: {id: 'player-9'}}, game: {data: {id: 'game-1'}}}
};
const included = [
  {type: 'new_player', id: 'player-9', attributes: {name: 'Fixture Quarterback', team: 'CHI'}, relationships: {team_data: {data: {id: 'team-1'}}}},
  {type: 'team', id: 'team-1', attributes: {market: 'Chicago', name: 'Bears', abbreviation: 'CHI'}},
  {type: 'team', id: 'team-2', attributes: {market: 'Carolina', name: 'Panthers', abbreviation: 'CAR'}},
  {type: 'game', id: 'game-1', attributes: {start_time: '2026-09-13T17:00:00Z'}, relationships: {home_team_data: {data: {id: 'team-2'}}, away_team_data: {data: {id: 'team-1'}}}}
];
const maps = {};
for(const item of included) (maps[item.type] ||= {})[item.id] = item;

test('parser preserves native IDs, status and authoritative team relationships', () => {
  const row = parseProjection(projection, maps, 'NFL');
  assert.equal(row.projectionId, 'projection-17');
  assert.equal(row.playerId, 'player-9');
  assert.equal(row.status, 'pre_game');
  assert.equal(row.Team, 'Chicago Bears');
  assert.equal(row.Opponent, 'Carolina Panthers');
  assert.equal(row.rank, 3);
  assert.equal(row.startTimeIso, '2026-09-13T17:05:00Z');
  assert.equal(row.line, '229.5');
});
test('numeric and string source lines retain exact decimal tokens before JSON parsing', () => {
  const raw = '{"data":[{"attributes":{"line_score":229.500000000000001,"rank":3,"description":"literal \\"line_score\\": 999.000000000000001"}},{"attributes":{"line_score":"0.100000000000000001"}},{"attributes":{"line_score":-1.2300e-4}}]}';
  const decoded = parseProjectionPayload(raw);
  assert.equal(decoded.data[0].attributes.line_score, '229.500000000000001');
  assert.equal(decoded.data[0].attributes.rank, 3);
  assert.equal(decoded.data[0].attributes.description, 'literal "line_score": 999.000000000000001');
  assert.equal(decoded.data[1].attributes.line_score, '0.100000000000000001');
  assert.equal(decoded.data[2].attributes.line_score, '-1.2300e-4');
  const copy = structuredClone(projection);
  copy.attributes.line_score = decoded.data[0].attributes.line_score;
  assert.equal(JSON.parse(JSON.stringify(parseProjection(copy, maps, 'NFL'))).line, '229.500000000000001');
  assert.throws(() => parseProjectionPayload('{"line_score":01}'));
  assert.throws(() => parseProjectionPayload({data:[]}));
});
test('malformed eligible projections throw and league counts reconcile before publication', () => {
  const bad = structuredClone(projection);
  bad.attributes.stat_type = {unexpected:'object'};
  assert.throws(() => parseProjection(bad, maps, 'NFL'), /Invalid stat type/);
  const excluded = structuredClone(projection);
  excluded.attributes.odds_type = 'demon';
  const inactive = structuredClone(projection);
  inactive.attributes.status = 'closed';
  const parsed = parseLeagueProjections([projection, excluded, inactive], maps, 'NFL', '2026-09-13T12:00:00Z');
  assert.deepEqual(parsed.counts, {sourceCount:3, acceptedCount:1, excludedCount:2, rejectedCount:0, publishedCount:1});
  assert.throws(() => parseLeagueProjections([projection, excluded, inactive, bad], maps, 'NFL', '2026-09-13T12:00:00Z'), error => {
    assert.equal(error.code, 'MALFORMED_PROJECTION');
    assert.deepEqual(error.projectionCounts, {sourceCount:4, acceptedCount:1, excludedCount:2, rejectedCount:1, publishedCount:0});
    return true;
  });
});
test('advertised incomplete pages and malformed success bodies fail closed', () => {
  for(const payload of [{}, {data:[], links:{next:'/next'}}, {data:[], meta:{total_pages:2}}, {data:[], meta:{next_page:2}}]) {
    assert.throws(() => assertCompleteProjectionPayload(payload));
  }
  assert.doesNotThrow(() => assertCompleteProjectionPayload({data:[], links:{next:null}}));
});
test('UTC midnight buckets in Chicago without fixed CST arithmetic', () => {
  assert.equal(getCstStartFields('2026-09-14T04:59:00Z').startDateCST, '2026-09-13');
  assert.equal(getCstStartFields('2026-09-14T05:00:00Z').startDateCST, '2026-09-14');
});
test('complete refresh replaces stale sport and team slices without external calls', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-refresh-test-'));
  try {
    fs.mkdirSync(path.join(root,'data/nba-today'),{recursive:true});
    fs.mkdirSync(path.join(root,'data/nfl-today'),{recursive:true});
    fs.writeFileSync(path.join(root,'data/prizepicks-nba.json'),'{"props":[{"stale":true}]}');
    fs.writeFileSync(path.join(root,'data/nba-today/old-team.json'),'{}');
    fs.writeFileSync(path.join(root,'data/nfl-today/old-team.json'),'{}');
    const module = {exports:{}};
    const precise = structuredClone(projection);
    precise.attributes.line_score = '229.500000000000001';
    const fakeRequire = name => name === 'axios' ? {get: async (url,config) => {
      assert.equal(config.responseType, 'text');
      return {status:200, config:{url}, data:JSON.stringify({data:config.params.league_id===9 ? [precise] : [], included})};
    }} : require(name);
    fakeRequire.main = {};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../scraper.js'),'utf8'), {
      module, require:fakeRequire, __dirname:root, process:{env:{}},
      console:{log(){},error(){}}, setTimeout:fn=>fn(), Date, Math, Intl
    });
    await module.exports.scrapePrizePicks();
    const master = JSON.parse(fs.readFileSync(path.join(root,'data/prizepicks.json')));
    assert.equal(master.leagueResults.length,4);
    assert.equal(master.completeness,'complete');
    assert.ok(master.props[0].providerFetchedAt);
    assert.equal(master.props[0].line, '229.500000000000001');
    assert.equal(master.leagueResults[0].sourceCount, 1);
    assert.equal(master.leagueResults[0].publishedCount, 1);
    const nba = JSON.parse(fs.readFileSync(path.join(root,'data/prizepicks-nba.json')));
    assert.equal(nba.totalProps,0);
    assert.equal(nba.collectionStatus.ok,true);
    assert.equal(fs.existsSync(path.join(root,'data/nba-today/old-team.json')),false);
    assert.equal(fs.existsSync(path.join(root,'data/nfl-today/old-team.json')),false);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('one malformed league cannot leak valid prefix rows into a partial capture', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-partial-test-'));
  try {
    const bad = structuredClone(projection);
    bad.attributes.stat_type = {};
    const excluded = structuredClone(projection);
    excluded.attributes.odds_type = 'goblin';
    const module = {exports:{}};
    const fakeRequire = name => name === 'axios' ? {get: async (url,config) => ({
      status:200, config:{url}, data:JSON.stringify({included, data:
        config.params.league_id===9 ? [projection, excluded, bad] : config.params.league_id===7 ? [projection] : []})
    })} : require(name);
    fakeRequire.main = {};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../scraper.js'),'utf8'), {
      module, require:fakeRequire, __dirname:root, process:{env:{}},
      console:{log(){},error(){}}, setTimeout:fn=>fn(), Date, Math, Intl
    });
    await module.exports.scrapePrizePicks();
    const master = JSON.parse(fs.readFileSync(path.join(root,'data/prizepicks.json')));
    assert.equal(master.completeness, 'partial');
    assert.equal(master.props.length, 1);
    assert.equal(master.props[0].sport, 'NBA');
    const nfl = master.leagueResults.find(row=>row.leagueName==='NFL');
    assert.equal(nfl.ok, false);
    assert.equal(nfl.errorCode, 'MALFORMED_PROJECTION');
    assert.deepEqual([nfl.sourceCount,nfl.acceptedCount,nfl.excludedCount,nfl.rejectedCount,nfl.publishedCount], [3,1,1,1,0]);
    const envelope = JSON.parse(fs.readFileSync(path.join(root,'data/prizepicks-nfl.json')));
    assert.equal(envelope.totalProps,0);
    assert.equal(envelope.collectionStatus.ok,false);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
