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

async function scrapePrizePicks() {
  console.log('🚀 Starting PrizePicks API scraper...');
  
  const allProps = [];
  // For debugging: collect all included objects
  let allIncluded = [];
  
  try {
    // Fetch projections for each league
    for (const [leagueName, leagueId] of Object.entries(LEAGUES)) {
      console.log(`📊 Fetching ${leagueName} props...`);
      
      try {
        const response = await axios.get(`https://api.prizepicks.com/projections`, {
          params: {
            league_id: leagueId,
            per_page: 250
          },
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Accept': 'application/json',
            'Referer': 'https://app.prizepicks.com/'
          },
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
        
        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.log(`   ⚠️  ${leagueName} fetch failed:`, error.message);
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
    await fs.writeFile(outputPath, JSON.stringify(allData, null, 2));
    
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
      await fs.writeFile(sportFile, JSON.stringify(sportData, null, 2));
      console.log(`   ✅ ${sport.toUpperCase()}: ${props.length} props → ${sportFile}`);

      // Create tomorrow-only NBA slice to keep payload small for GPT
      if (sport === 'nba') {
        const now = new Date();
        const tomorrowStart = new Date(now);
        tomorrowStart.setDate(now.getDate() + 1);
        tomorrowStart.setHours(0, 0, 0, 0);
        const tomorrowEnd = new Date(tomorrowStart);
        tomorrowEnd.setHours(23, 59, 59, 999);

        const tomorrowProps = props.filter(p => {
          if (!p.startTimeIso) return false;
          const d = new Date(p.startTimeIso);
          return d >= tomorrowStart && d <= tomorrowEnd;
        });

        const tomorrowFile = path.join(dataDir, `prizepicks-${sport}-tomorrow.json`);
        const tomorrowData = {
          scrapedAt: allData.scrapedAt,
          scrapedDate: allData.scrapedDate,
          source: allData.source,
          sport: sport.toUpperCase(),
          day: 'tomorrow',
          totalProps: tomorrowProps.length,
          props: tomorrowProps
        };
        await fs.writeFile(tomorrowFile, JSON.stringify(tomorrowData, null, 2));
        console.log(`   ✅ ${sport.toUpperCase()} (TOMORROW): ${tomorrowProps.length} props → ${tomorrowFile}`);
      }
    }
    
    return allData;
    
  } catch (error) {
    console.error('❌ Scraping failed:', error.message);
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
    return attrs.abbreviation === opponentName || attrs.name === opponentName || attrs.full_name === opponentName;
  });
  if (!match) return null;
  const attrs = match.attributes || {};
  const parts = [];
  if (attrs.market) parts.push(attrs.market);
  if (attrs.name || attrs.full_name) parts.push(attrs.name || attrs.full_name);
  return parts.length ? parts.join(' ') : null;
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
    const { name: teamName, full: teamFull } = getTeamInfo(projection, includedData);

    const gameId = projection.relationships?.game?.data?.id || null;
    const gameData = gameId ? includedData.game?.[gameId] : null;
    let opponentName = pickOpponentFromGame(gameData, teamName);
    if (!opponentName) {
      opponentName = attrs.opponent || attrs.opponent_name || attrs.description || null;
    }
    const opponentFull = getOpponentFull(opponentName, includedData);
    const startTimeCentral = formatStartTimeToCentral(attrs.start_time);
    const startTimeIso = attrs.start_time || null;

    // Parse stat type - remove "(Combo)" suffix if present
    let statType = attrs.stat_type || attrs.stat_display_name || 'Unknown';
    statType = statType.replace(/\s*\(Combo\)\s*/gi, '').trim();
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
        Opponent: opponentFull || null,
        gameId
      };
    }
    
    return null;
  } catch (error) {
    console.error('Error parsing projection:', error.message);
    return null;
  }
}

// Run the scraper
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
