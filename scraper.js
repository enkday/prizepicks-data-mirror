const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

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

// Realistic User-Agent strings to rotate through
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0'
];

/**
 * Get a random User-Agent string from the list
 */
function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function scrapePrizePicks() {
  console.log('🚀 Starting PrizePicks data fetch...');
  
  // Check for optional Cookie environment variable
  const cookieHeader = process.env.PRIZEPICKS_COOKIE;
  if (cookieHeader) {
    console.log('🍪 Cookie header detected from PRIZEPICKS_COOKIE environment variable');
  } else {
    console.log('ℹ️  No PRIZEPICKS_COOKIE environment variable set');
  }
  
  const allProps = [];
  // For debugging: collect all included objects
  let allIncluded = [];
  
  try {
    // Fetch projections for each league
    for (const [leagueName, leagueId] of Object.entries(LEAGUES)) {
      console.log(`\n📊 Fetching ${leagueName} props...`);
      
      try {
        // Build request URL
        const url = 'https://api.prizepicks.com/projections';
        const params = {
          league_id: leagueId,
          per_page: 250
        };
        
        // Build request headers with randomized User-Agent
        const userAgent = getRandomUserAgent();
        const headers = {
          'User-Agent': userAgent,
          'Accept': 'application/json',
          'Referer': 'https://app.prizepicks.com/'
        };
        
        // Add Cookie header if available
        if (cookieHeader) {
          headers['Cookie'] = cookieHeader;
        }
        
        // Log the full request details for debugging
        const fullUrl = `${url}?${new URLSearchParams(params).toString()}`;
        console.log(`   🌐 URL: ${fullUrl}`);
        
        // Log headers with cookie value masked for security
        const headersForLogging = { ...headers };
        if (headersForLogging['Cookie']) {
          headersForLogging['Cookie'] = '[REDACTED]';
        }
        console.log(`   📋 Headers:`, JSON.stringify(headersForLogging, null, 2));
        console.log(`   🍪 Cookie included: ${cookieHeader ? 'Yes' : 'No'}`);
        
        const response = await axios.get(url, {
          params,
          headers,
          timeout: 10000
        });
        
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
        
        // Add delay to avoid rate limiting (increased from 500ms to 2000ms)
        console.log(`   ⏳ Waiting 2000ms before next request to avoid rate limiting...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        
      } catch (error) {
        console.log(`   ⚠️  ${leagueName} fetch failed:`, error.message);
        if (error.response) {
          console.log(`   📛 HTTP Status: ${error.response.status}`);
          // Log response headers with any sensitive data redacted
          const responseHeadersForLogging = { ...error.response.headers };
          if (responseHeadersForLogging['set-cookie']) {
            responseHeadersForLogging['set-cookie'] = '[REDACTED]';
          }
          console.log(`   📛 Response Headers:`, JSON.stringify(responseHeadersForLogging, null, 2));
          // Only log error message from response data, not full data which may contain sensitive info
          if (error.response.data) {
            const errorMsg = error.response.data.error || error.response.data.message || 'No error message available';
            console.log(`   📛 Error Message:`, errorMsg);
          }
        }
      }
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

      // Create NBA/NFL day- and team-specific slices to keep payloads small for GPT
      if (sport === 'nba' || sport === 'nfl') {
        const now = new Date();
        const getWindow = (offsetDays) => {
          const start = new Date(now);
          start.setDate(now.getDate() + offsetDays);
          start.setHours(0, 0, 0, 0);
          const end = new Date(start);
          end.setHours(23, 59, 59, 999);
          return { start, end };
        };

        const buildDaySlice = async (label, offsetDays) => {
          const { start, end } = getWindow(offsetDays);
          const dayProps = props.filter(p => {
            if (!p.startTimeIso) return false;
            const d = new Date(p.startTimeIso);
            return d >= start && d <= end;
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
