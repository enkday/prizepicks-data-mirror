const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const {parseProjection, assertCompleteProjectionPayload, getCstStartFields} = require('../scraper');

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
    const fakeRequire = name => name === 'axios' ? {get: async (url,config) => ({status:200, config:{url}, data:{data:config.params.league_id===9 ? [projection] : [], included}})} : require(name);
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
    const nba = JSON.parse(fs.readFileSync(path.join(root,'data/prizepicks-nba.json')));
    assert.equal(nba.totalProps,0);
    assert.equal(nba.collectionStatus.ok,true);
    assert.equal(fs.existsSync(path.join(root,'data/nba-today/old-team.json')),false);
    assert.equal(fs.existsSync(path.join(root,'data/nfl-today/old-team.json')),false);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
