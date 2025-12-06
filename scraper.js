const { chromium } = require('playwright');
const fs = require('fs').promises;
const path = require('path');

/**
 * PrizePicks Scraper
 * Extracts current prop bet options from PrizePicks
 */

async function scrapePrizePicks() {
  console.log('🚀 Starting PrizePicks scraper...');
  
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();
    
    console.log('📱 Loading PrizePicks app...');
    
    // Navigate to the app with more lenient timeout
    try {
      await page.goto('https://app.prizepicks.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
    } catch (error) {
      console.log('⚠️  Page load timed out, but continuing anyway...');
    }
    
    // Wait for content to load (adjust selectors based on actual site structure)
    await page.waitForTimeout(5000);
    
    // Intercept API calls to get the actual data
    const propBets = [];
    
    // Listen for API responses
    page.on('response', async (response) => {
      const url = response.url();
      
      // Look for API endpoints that contain player projections
      // These patterns are examples - you'll need to inspect the actual network calls
      if (url.includes('/api/projections') || 
          url.includes('/api/props') || 
          url.includes('/api/players')) {
        try {
          const data = await response.json();
          console.log('📊 Found API data:', url);
          propBets.push({
            url: url,
            timestamp: new Date().toISOString(),
            data: data
          });
        } catch (e) {
          // Not JSON or error parsing
        }
      }
    });
    
    // Trigger some interactions to load data
    await page.waitForTimeout(3000);
    
    // Try to extract data from the page DOM
    const pageData = await page.evaluate(() => {
      const props = [];
      
      // Example selectors - these WILL need to be updated based on actual site structure
      // You'll need to inspect the PrizePicks app to find the correct selectors
      
      // Look for player cards or prop bet elements
      const playerElements = document.querySelectorAll('[data-testid*="player"], .player-card, .projection-card');
      
      playerElements.forEach((element) => {
        try {
          const playerName = element.querySelector('[data-testid*="name"], .player-name')?.textContent?.trim();
          const statType = element.querySelector('[data-testid*="stat"], .stat-type')?.textContent?.trim();
          const line = element.querySelector('[data-testid*="line"], .projection-line')?.textContent?.trim();
          const sport = element.querySelector('[data-testid*="sport"], .sport')?.textContent?.trim();
          
          if (playerName && statType && line) {
            props.push({
              player: playerName,
              stat: statType,
              line: parseFloat(line) || line,
              sport: sport || 'Unknown'
            });
          }
        } catch (e) {
          // Skip elements that don't match expected structure
        }
      });
      
      return props;
    });
    
    console.log(`✅ Scraped ${pageData.length} props from DOM`);
    
    // Combine data from API calls and DOM scraping
    const allData = {
      scrapedAt: new Date().toISOString(),
      scrapedDate: new Date().toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      }),
      source: 'PrizePicks',
      totalProps: pageData.length,
      props: pageData,
      apiResponses: propBets.length > 0 ? propBets : undefined
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
  } finally {
    await browser.close();
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
