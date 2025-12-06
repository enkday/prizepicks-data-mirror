const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

/**
 * PrizePicks Scraper
 * Fetches current prop bet options from PrizePicks API
 */

// League IDs (from PrizePicks API)
const LEAGUES = {
  NFL: 1,
  NBA: 7,
  MLB: 2,
  NHL: 3,
  NCAAF: 9,  // College Football
  NCAAB: 6,  // College Basketball
  SOCCER: 12,
  ESPORTS: 13,
  UFC: 14,
  GOLF: 5
};

async function scrapePrizePicks() {
  console.log('🚀 Starting PrizePicks API scraper...');
  
  const allProps = [];
  const includedData = {};
  
  try {
    // Fetch projections for each league
    for (const [leagueName, leagueId] of Object.entries(LEAGUES)) {
      console.log(`📊 Fetching ${leagueName} props...`);
      
      try {
        const response = await axios.get(`https://api.prizepicks.com/projections`, {
          params: {
            league_id: leagueId,
            per_page: 250  // Get more results
          },
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Accept': 'application/json',
            'Referer': 'https://app.prizepicks.com/'
          },
          timeout: 10000
        });
        
        const data = response.data;
        
        // Store included data (players, teams, etc.) for reference
        if (data.included) {
          data.included.forEach(item => {
            if (!includedData[item.type]) {
              includedData[item.type] = {};
            }
            includedData[item.type][item.id] = item;
          });
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
    
    // Save to JSON
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
      props: allProps
    };
    
    // Save to data directory
    const dataDir = path.join(__dirname, 'data');
    await fs.mkdir(dataDir, { recursive: true });
    
    const outputPath = path.join(dataDir, 'prizepicks.json');
    await fs.writeFile(outputPath, JSON.stringify(allData, null, 2));
    
    console.log(`💾 Data saved to ${outputPath}`);
    console.log(`📈 Total props scraped: ${allData.totalProps}`);
    
    return allData;
    
  } catch (error) {
    console.error('❌ Scraping failed:', error.message);
    throw error;
  }
}

// Helper function to parse projection and extract player info
function parseProjection(projection, includedData, leagueName) {
  try {
    const attrs = projection.attributes;
    if (!attrs) return null;
    
    // Get player info from relationships
    let playerName = 'Unknown';
    let teamName = null;
    let opponentName = null;
    
    if (projection.relationships) {
      // Get new_player data
      const newPlayerId = projection.relationships.new_player?.data?.id;
      if (newPlayerId && includedData.new_player && includedData.new_player[newPlayerId]) {
        const playerData = includedData.new_player[newPlayerId];
        playerName = playerData.attributes?.name || playerName;
        
        // Get team
        const teamId = playerData.relationships?.team?.data?.id;
        if (teamId && includedData.team && includedData.team[teamId]) {
          teamName = includedData.team[teamId].attributes?.name;
        }
      }
      
      // Try to get opponent info
      const gameId = projection.relationships.game?.data?.id;
      if (gameId && includedData.game && includedData.game[gameId]) {
        const gameData = includedData.game[gameId];
        opponentName = gameData.attributes?.opponent_name;
      }
    }
    
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
        // Optional fields only if available
        ...(teamName && { team: teamName }),
        ...(opponentName && { opponent: opponentName })
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
