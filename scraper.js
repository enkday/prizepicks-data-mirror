const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const isGithubActions = process.env.GITHUB_ACTIONS === 'true';

const PRIZEPICKS_BASE_URLS = (
  process.env.PRIZEPICKS_BASE_URL
    ? [process.env.PRIZEPICKS_BASE_URL]
    : isGithubActions
      ? ['https://partner-api.prizepicks.com', 'https://api.prizepicks.com']
      : ['https://api.prizepicks.com', 'https://partner-api.prizepicks.com']
).map(s => s.replace(/\/$/, ''));

const PRIZEPICKS_DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://app.prizepicks.com/',
  'Origin': 'https://app.prizepicks.com',
  'DNT': '1'
};

function parseRetryAfterMs(retryAfterHeader) {
  if (!retryAfterHeader) return null;
  const asNumber = Number(retryAfterHeader);
  if (Number.isFinite(asNumber) && asNumber >= 0) return asNumber * 1000;
  const asDate = new Date(retryAfterHeader);
  if (!Number.isNaN(asDate.getTime())) {
    const delta = asDate.getTime() - Date.now();
    return Math.max(0, delta);
  }
  return null;
}

async function axiosGetWithRetry(
  url,
  config,
  { maxAttempts = 6, baseDelayMs = 1500, minDelayMs = 0, maxDelayMs = 30000 } = {}
) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await axios.get(url, config);
    } catch (error) {
      lastError = error;
      const status = error?.response?.status;
      const isRetryable = status === 429 || (status >= 500 && status <= 599);
      if (!isRetryable || attempt === maxAttempts) break;

      const retryAfterMs = parseRetryAfterMs(error?.response?.headers?.['retry-after']);
      const backoffMs = Math.min(maxDelayMs, Math.round(baseDelayMs * (2 ** (attempt - 1))));
      const jitterMs = Math.floor(Math.random() * 250);
      // Many CDNs send Retry-After: 1 repeatedly; enforce a sane minimum in CI.
      const chosenMs = retryAfterMs ?? backoffMs;
      const waitMs = Math.max(minDelayMs, Math.max(0, chosenMs + jitterMs));
      console.log(`   ⏳ Rate limited (${status}); retrying in ${Math.ceil(waitMs / 1000)}s (attempt ${attempt + 1}/${maxAttempts})...`);
      await sleep(waitMs);
    }
  }

  throw lastError;
}

async function fetchProjectionsForLeague(leagueId) {
  let lastError;
  for (const baseUrl of PRIZEPICKS_BASE_URLS) {
    const url = `${baseUrl}/projections`;
    try {
      const response = await axiosGetWithRetry(
        url,
        {
          params: { league_id: leagueId, per_page: 250 },
          headers: PRIZEPICKS_DEFAULT_HEADERS,
          timeout: 20000
        },
        {
          maxAttempts: 10,
          baseDelayMs: 2500,
          minDelayMs: isGithubActions ? 5000 : 0,
          maxDelayMs: isGithubActions ? 60000 : 30000
        }
      );

      return response;
    } catch (error) {
      lastError = error;
      const status = error?.response?.status;
      if (status === 401 || status === 403) {
        console.log(`   🔒 Blocked on ${baseUrl} (HTTP ${status}); trying alternate host...`);
        continue;
      }
      if (status === 429) {
        console.log(`   🧱 Rate limited on ${baseUrl} (HTTP 429); trying alternate host...`);
        continue;
      }
    }
  }

  throw lastError ?? new Error('Failed to fetch projections');
}

async function fetchProjectionsForLeagueWithCooldown(leagueId, leagueName) {
  const maxCycles = Number(process.env.PRIZEPICKS_LEAGUE_CYCLES || 3);
  const baseCooldownMs = Number(process.env.PRIZEPICKS_LEAGUE_COOLDOWN_MS || (isGithubActions ? 20000 : 5000));
  const maxCooldownMs = Number(process.env.PRIZEPICKS_LEAGUE_MAX_COOLDOWN_MS || (isGithubActions ? 120000 : 30000));

  let lastError;
  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    try {
      return await fetchProjectionsForLeague(leagueId);
    } catch (error) {
      lastError = error;
      const status = error?.response?.status;
      if (status !== 429 || cycle === maxCycles) break;

      const waitMs = Math.min(maxCooldownMs, baseCooldownMs * cycle) + Math.floor(Math.random() * 500);
      console.log(`   🧊 ${leagueName} still rate-limited; cooling down ${Math.ceil(waitMs / 1000)}s (cycle ${cycle + 1}/${maxCycles})...`);
      await sleep(waitMs);
    }
  }
  throw lastError;
}

/**
 * PrizePicks Scraper
 * Fetches current prop bet options from PrizePicks API
 * League IDs verified from partner-api.prizepicks.com/leagues
 */

// Correct League IDs from PrizePicks API
const LEAGUES = {
  NFL: 9,        // NFL
  NCAAF: 15,     // College Football  
  NBA: 7,        // NBA
  MLB: 2         // MLB (offseason - will return 0 props)
  // NCAAB and College Baseball IDs to be added when seasons are active
};

async function scrapePrizePicks() {
  console.log('🚀 Starting PrizePicks data fetch...');
  
  const allProps = [];
  // For debugging: collect all included objects
  let allIncluded = [];
  const leagueResults = [];
  
  try {
    // Fetch projections for each league
    for (const [leagueName, leagueId] of Object.entries(LEAGUES)) {
      console.log(`📊 Fetching ${leagueName} props...`);
      
      try {
        const response = await fetchProjectionsForLeagueWithCooldown(leagueId, leagueName);
        
        const data = response.data;
        // Build included maps per response (players, teams, games, etc.)
        const includedData = buildIncludedMap(data.included || []);
        // Collect all included objects for debugging
        allIncluded = allIncluded.concat(data.included || []);
        
        // DEBUG: Print all available fields for the first projection in this league
        if (data.data && Array.isArray(data.data) && data.data.length > 0 && leagueName === 'NCAAF') {
          console.log('\n=== RAW FIELDS FOR FIRST NCAAF PROJECTION ===');
          console.log(JSON.stringify(data.data[0], null, 2));
        }
        // Process projections
        if (data.data && Array.isArray(data.data)) {
          data.data.forEach(projection => {
            const prop = parseProjection(projection, includedData, leagueName);
            if (prop) {
              allProps.push(prop);
            }
          });
          console.log(`   ✅ Found ${data.data.length} ${leagueName} props`);
        }

        leagueResults.push({ leagueName, ok: true, status: response.status, count: Array.isArray(data.data) ? data.data.length : 0 });
        
        // Add delay to avoid rate limiting (with jitter)
        await sleep(1500 + Math.floor(Math.random() * 900));
        
      } catch (error) {
        const status = error?.response?.status;
        console.log(`   ⚠️  ${leagueName} fetch failed:`, status ? `HTTP ${status}` : error.message);
        leagueResults.push({ leagueName, ok: false, status: status ?? null, count: 0 });
      }
    }

    // If we got blocked across all meaningful leagues, fail loudly so CI isn't "green" with empty data.
    const meaningful = leagueResults.filter(r => r.leagueName !== 'MLB');
    const anyMeaningfulOk = meaningful.some(r => r.ok);
    if (!anyMeaningfulOk || allProps.length === 0) {
      const summary = leagueResults
        .map(r => `${r.leagueName}:${r.ok ? 'ok' : 'fail'}${r.status ? `(${r.status})` : ''}`)
        .join(', ');
      throw new Error(`All leagues blocked or empty scrape. Results: ${summary}`);
    }
    
    console.log(`\n✅ Total props scraped: ${allProps.length}`);
    
    // Save to JSON (now includes allIncluded for debugging)
    const allData = {
      scrapedAt: new Date().toISOString(),
      scrapedDate: new Date().toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short'
      }),
      source: 'PrizePicks API',
      totalProps: allProps.length,
      props: allProps,
      included: allIncluded
    };
    
    // Save to data directory
    const dataDir = path.join(__dirname, 'data');
    await fs.mkdir(dataDir, { recursive: true });
    
    const outputPath = path.join(dataDir, 'prizepicks.json');
    await fs.writeFile(outputPath, JSON.stringify(allData, null, 2), { mode: 0o666 });
    
    console.log(`💾 Data saved to ${outputPath}`);
    console.log(`📈 Total props scraped: ${allData.totalProps}`);
    
    // Split into sport-specific files
    console.log(`\n📂 Creating sport-specific files...`);
    const SLICE_EXCLUDED_SPORTS = new Set(['soccer', 'golf']);
    const bySport = {};
    allProps.forEach(prop => {
      const sport = prop.sport.toLowerCase();
      if (!bySport[sport]) bySport[sport] = [];
      // Only include standard odds (exclude demon/goblin variants)
      if (!prop.oddsType || (prop.oddsType !== 'demon' && prop.oddsType !== 'goblin')) {
        bySport[sport].push(prop);
      }
    });

    for (const [sport, props] of Object.entries(bySport)) {
      const sportFile = path.join(dataDir, `prizepicks-${sport}.json`);
      const sportData = {
        scrapedAt: allData.scrapedAt,
        scrapedDate: allData.scrapedDate,
        source: allData.source,
        sport: sport.toUpperCase(),
        totalProps: props.length,
        props: props
      };
      await fs.writeFile(sportFile, JSON.stringify(sportData, null, 2), { mode: 0o666 });
      console.log(`   ✅ ${sport.toUpperCase()}: ${props.length} props → ${sportFile}`);

      // Create a next-7-days slice for ALL sports except Soccer/Golf
      if (!SLICE_EXCLUDED_SPORTS.has(sport)) {
        const toCstDateKey = (date) => {
          const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Chicago',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          })
            .formatToParts(date)
            .reduce((acc, part) => {
              acc[part.type] = part.value;
              return acc;
            }, {});
          return `${parts.year}-${parts.month}-${parts.day}`;
        };

        const getCstDayKey = (offsetDays) => {
          const cstTodayKey = toCstDateKey(new Date());
          const [y, m, d] = cstTodayKey.split('-').map(n => parseInt(n, 10));
          const baseUtcNoon = new Date(Date.UTC(y, m - 1, d, 18, 0, 0));
          baseUtcNoon.setUTCDate(baseUtcNoon.getUTCDate() + offsetDays);
          return toCstDateKey(baseUtcNoon);
        };

        const buildNextDaysSlice = async (label, days, includeTeams) => {
          const dayKeys = new Set(Array.from({ length: days }, (_, i) => getCstDayKey(i)));
          const rangeProps = props.filter(p => {
            if (!p.startTimeIso) return false;
            const startDateCST = p.startDateCST || getCstStartFields(p.startTimeIso).startDateCST;
            return startDateCST && dayKeys.has(startDateCST);
          });

          const baseFile = path.join(dataDir, `prizepicks-${sport}-${label}.json`);
          const payload = {
            scrapedAt: allData.scrapedAt,
            scrapedDate: allData.scrapedDate,
            source: allData.source,
            sport: sport.toUpperCase(),
            day: label,
            totalProps: rangeProps.length,
            props: rangeProps
          };
          await fs.writeFile(baseFile, JSON.stringify(payload, null, 2), { mode: 0o666 });
          console.log(`   ✅ ${sport.toUpperCase()} (${label.toUpperCase()}): ${rangeProps.length} props → ${baseFile}`);

          if (!includeTeams) return;

          const byTeam = {};
          rangeProps.forEach(p => {
            if (!p.Team) return;
            if (!byTeam[p.Team]) byTeam[p.Team] = [];
            byTeam[p.Team].push(p);
          });

          const teamDir = path.join(dataDir, `${sport}-${label}`);
          await fs.mkdir(teamDir, { recursive: true });
          for (const [teamName, teamProps] of Object.entries(byTeam)) {
            const slug = slugifyTeam(teamName);
            if (!slug) continue;
            const teamFile = path.join(teamDir, `${slug}.json`);
            const teamPayload = {
              scrapedAt: allData.scrapedAt,
              scrapedDate: allData.scrapedDate,
              source: allData.source,
              sport: sport.toUpperCase(),
              day: label,
              team: teamName,
              totalProps: teamProps.length,
              props: teamProps
            };
            await fs.writeFile(teamFile, JSON.stringify(teamPayload, null, 2), { mode: 0o666 });
          }
        };

        await buildNextDaysSlice('next-7-days', 7, sport === 'nba' || sport === 'nfl');
      }

      // Create NBA/NFL day- and team-specific slices to keep payloads small for GPT
      if (sport === 'nba' || sport === 'nfl') {
        const toCstDateKey = (date) => {
          const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Chicago',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          })
            .formatToParts(date)
            .reduce((acc, part) => {
              acc[part.type] = part.value;
              return acc;
            }, {});
          return `${parts.year}-${parts.month}-${parts.day}`;
        };

        const getCstDayKey = (offsetDays) => {
          // Compute “today” in America/Chicago, then add offset days.
          const cstTodayKey = toCstDateKey(new Date());
          const [y, m, d] = cstTodayKey.split('-').map(n => parseInt(n, 10));
          // Use UTC noon for a stable day addition across DST boundaries.
          const baseUtcNoon = new Date(Date.UTC(y, m - 1, d, 18, 0, 0));
          baseUtcNoon.setUTCDate(baseUtcNoon.getUTCDate() + offsetDays);
          return toCstDateKey(baseUtcNoon);
        };

        const buildDaySlice = async (label, offsetDays) => {
          const dayKey = getCstDayKey(offsetDays);
          const dayProps = props.filter(p => {
            if (!p.startTimeIso) return false;
            const startDateCST = p.startDateCST || getCstStartFields(p.startTimeIso).startDateCST;
            return startDateCST === dayKey;
          });

          const baseFile = path.join(dataDir, `prizepicks-${sport}-${label}.json`);
          const payload = {
            scrapedAt: allData.scrapedAt,
            scrapedDate: allData.scrapedDate,
            source: allData.source,
            sport: sport.toUpperCase(),
            day: label,
            totalProps: dayProps.length,
            props: dayProps
          };
          await fs.writeFile(baseFile, JSON.stringify(payload, null, 2), { mode: 0o666 });
          console.log(`   ✅ ${sport.toUpperCase()} (${label.toUpperCase()}): ${dayProps.length} props → ${baseFile}`);

          // Team-specific slices
          const byTeam = {};
          dayProps.forEach(p => {
            if (!p.Team) return;
            if (!byTeam[p.Team]) byTeam[p.Team] = [];
            byTeam[p.Team].push(p);
          });

          const teamDir = path.join(dataDir, `${sport}-${label}`);
          await fs.mkdir(teamDir, { recursive: true });
          for (const [teamName, teamProps] of Object.entries(byTeam)) {
            const slug = slugifyTeam(teamName);
            if (!slug) continue;
            const teamFile = path.join(teamDir, `${slug}.json`);
            const teamPayload = {
              scrapedAt: allData.scrapedAt,
              scrapedDate: allData.scrapedDate,
              source: allData.source,
              sport: sport.toUpperCase(),
              day: label,
              team: teamName,
              totalProps: teamProps.length,
              props: teamProps
            };
            await fs.writeFile(teamFile, JSON.stringify(teamPayload, null, 2), { mode: 0o666 });
            console.log(`      • ${sport.toUpperCase()} ${label.toUpperCase()} ${teamName}: ${teamProps.length} props → ${teamFile}`);
          }
        };


        await buildDaySlice('today', 0);
        await buildDaySlice('tomorrow', 1);
      }
    }
    
    return allData;
    
  } catch (error) {
    console.error('❌ Scraping failed:', error.message);
    console.error(error.stack);
    throw error;
  }
}

function buildIncludedMap(includedArray) {
  return (includedArray || []).reduce((acc, item) => {
    if (!acc[item.type]) acc[item.type] = {};
    acc[item.type][item.id] = item;
    return acc;
  }, {});
}

function getTeamInfo(projection, includedData) {
  const attrs = projection.attributes || {};
  const relationships = projection.relationships || {};

  const buildFull = (market, name) => {
    const parts = [];
    if (market) parts.push(market);
    if (name) parts.push(name);
    return parts.length ? parts.join(' ') : null;
  };

  const playerId = relationships.new_player?.data?.id;
  if (playerId) {
    const playerData = includedData.new_player?.[playerId];
    if (playerData) {
      const market = playerData.attributes?.market || null;
      const codeFromPlayer = playerData.attributes?.team || null;
      const nameFromPlayer = playerData.attributes?.team_name || null;
      const teamId = playerData.relationships?.team?.data?.id;
      if (teamId) {
        const teamData = includedData.team?.[teamId];
        const attrs = teamData?.attributes || {};
        return {
          name: attrs.name || attrs.full_name || nameFromPlayer || codeFromPlayer || null,
          code: attrs.abbreviation || codeFromPlayer || null,
          market: attrs.market || market || null,
          full: buildFull(attrs.market || market, attrs.name || attrs.full_name || nameFromPlayer || codeFromPlayer)
        };
      }
      return {
        name: nameFromPlayer || codeFromPlayer || null,
        code: codeFromPlayer || null,
        market,
        full: buildFull(market, nameFromPlayer || codeFromPlayer)
      };
    }
  }

  const directTeamId = relationships.team?.data?.id;
  if (directTeamId) {
    const teamData = includedData.team?.[directTeamId];
    const attrs = teamData?.attributes || {};
    return {
      name: attrs.name || attrs.full_name || attrs.abbreviation || null,
      code: attrs.abbreviation || null,
      market: attrs.market || null,
      full: buildFull(attrs.market, attrs.name || attrs.full_name || attrs.abbreviation)
    };
  }

  return {
    name: attrs.team_name || attrs.team || null,
    code: attrs.team || null,
    market: attrs.market || null,
    full: buildFull(attrs.market, attrs.team_name || attrs.team)
  };
}

function pickOpponentFromGame(gameData, playerTeam) {
  if (!gameData?.attributes) return null;
  const g = gameData.attributes;
  const home = g.home_team_name || g.home_team;
  const away = g.away_team_name || g.away_team;
  // Try to pick the opposite side if we know the player's team
  if (playerTeam && home && away) {
    if (playerTeam === home) return away;
    if (playerTeam === away) return home;
  }
  return g.opponent_name || g.away_team_name || g.home_team_name || g.description || null;
}

function getOpponentFull(opponentName, includedData) {
  if (!opponentName) return null;
  const teams = includedData.team ? Object.values(includedData.team) : [];
  const match = teams.find(t => {
    const attrs = t.attributes || {};
    return attrs.abbreviation === opponentName || attrs.name === opponentName || attrs.full_name === opponentName || attrs.market === opponentName;
  });
  if (!match) return { full: null, code: null };
  const attrs = match.attributes || {};
  const parts = [];
  if (attrs.market) parts.push(attrs.market);
  if (attrs.name || attrs.full_name) parts.push(attrs.name || attrs.full_name);
  return {
    full: parts.length ? parts.join(' ') : null,
    code: attrs.abbreviation || null
  };
}

function formatStartTimeToCentral(isoString) {
  if (!isoString) return null;
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.month}/${parts.day}/${parts.year} ${parts.hour}:${parts.minute} ${parts.dayPeriod} CST`;
}

function getCstStartFields(isoString) {
  if (!isoString) return { startTimeCST: null, startDateCST: null };
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return { startTimeCST: isoString, startDateCST: null };

  const timeParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  })
    .formatToParts(date)
    .reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});

  const dateParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
    .formatToParts(date)
    .reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});

  const startTimeCST = `${timeParts.month}/${timeParts.day}/${timeParts.year} ${timeParts.hour}:${timeParts.minute} ${timeParts.dayPeriod} CST`;
  const startDateCST = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;

  return { startTimeCST, startDateCST };
}

function slugifyTeam(name) {
  if (!name) return null;
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Helper function to parse projection and extract player info
function parseProjection(projection, includedData, leagueName) {
  try {
    const attrs = projection.attributes;
    if (!attrs) return null;
    
    const oddsType = attrs.odds_type;
    // Only keep standard props (exclude demon/goblin variants)
    if (oddsType === 'demon' || oddsType === 'goblin') {
      return null;
    }
    
    const playerId = projection.relationships?.new_player?.data?.id;
    const playerData = playerId ? includedData.new_player?.[playerId] : null;
    const playerName = playerData?.attributes?.name || 'Unknown';
    const { name: teamName, code: teamCode, full: teamFull } = getTeamInfo(projection, includedData);

    const gameId = projection.relationships?.game?.data?.id || null;
    const gameData = gameId ? includedData.game?.[gameId] : null;
    let opponentName = pickOpponentFromGame(gameData, teamName);
    if (!opponentName) {
      opponentName = attrs.opponent || attrs.opponent_name || attrs.description || null;
    }
    const opponentInfo = getOpponentFull(opponentName, includedData);
    const startTimeCentral = formatStartTimeToCentral(attrs.start_time);
    const startTimeIso = attrs.start_time || null;
    const { startTimeCST, startDateCST } = getCstStartFields(startTimeIso);
    const rank = attrs.rank;

    // Parse stat type - remove "(Combo)" suffix if present
    let statType = attrs.stat_type || attrs.stat_display_name || 'Unknown';
    statType = statType.replace(/\s*\(Combo\)\s*/gi, '').trim();
    // Drop fantasy score and combo/combined stat types to keep payload smaller
    const statLower = statType.toLowerCase();
    if (
      statLower.includes('fantasy score') ||
      statLower.includes('combo') ||
      statType.includes('+') ||
      attrs.event_type === 'combo'
    ) {
      return null;
    }
    // Only include active props
    if (attrs.status === 'pre_game' || attrs.status === 'live') {
      return {
        player: playerName,
        stat: statType,
        line: parseFloat(attrs.line_score),
        sport: leagueName,
        startTime: startTimeCentral,
        startTimeCST,
        startDateCST,
        startTimeIso,
        oddsType: oddsType,
        Team: teamFull || null,
        teamCode: teamCode || null,
        Opponent: opponentInfo.full || opponentName || null,
        opponentCode: opponentInfo.code || null,
        rank: rank !== undefined ? rank : null,
        gameId
      };
    }
    
    return null;
  } catch (error) {
    console.error('Error parsing projection:', error.message);
    return null;
  }
}

// Run the data fetch
if (require.main === module) {
  scrapePrizePicks()
    .then(() => {
      console.log('✨ Scraping completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Scraping failed:', error);
      process.exit(1);
    });
}

module.exports = { scrapePrizePicks };
