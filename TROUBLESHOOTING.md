# PrizePicks Scraper Troubleshooting Guide

## Recent Improvements (December 2025)

The scraper has been enhanced to handle rate limiting and API restrictions more effectively:

### 1. Rate Limiting Protection
- Delay between league requests increased from 500ms to 2000ms
- This helps avoid 429 (Too Many Requests) errors

### 2. Enhanced Debugging Logs
Each API request now logs:
- Full URL with query parameters
- All HTTP headers (with sensitive data redacted)
- Cookie inclusion status
- Detailed error information including HTTP status codes

### 3. Cookie Support for 403 Errors
If you're experiencing 403 (Forbidden) errors, especially with NCAAF:

1. Open your browser and navigate to https://app.prizepicks.com
2. Open Developer Tools (F12)
3. Go to the Network tab
4. Find a request to `api.prizepicks.com`
5. Copy the Cookie header value
6. Set it as an environment variable:

```bash
export PRIZEPICKS_COOKIE="your_cookie_value_here"
node scraper.js
```

Or in GitHub Actions, add a secret named `PRIZEPICKS_COOKIE` and update the workflow:

```yaml
- name: 🏃 Run PrizePicks scraper
  env:
    PRIZEPICKS_COOKIE: ${{ secrets.PRIZEPICKS_COOKIE }}
  run: node scraper.js
```

### 4. Randomized User-Agents
The scraper now randomly selects from 6 realistic browser User-Agent strings to avoid being detected as a bot.

## Common Error Messages

### `getaddrinfo ENOTFOUND api.prizepicks.com`
- Network connectivity issue
- Check your internet connection
- Ensure api.prizepicks.com is accessible

### `403 Forbidden`
- API is blocking your requests
- Try setting the PRIZEPICKS_COOKIE environment variable (see above)
- Wait a few minutes and try again

### `429 Too Many Requests`
- You're being rate-limited
- The scraper now waits 2000ms between requests
- If still seeing this, increase the delay in scraper.js (line ~120)

## Log Output Example

```
🚀 Starting PrizePicks data fetch...
🍪 Cookie header detected from PRIZEPICKS_COOKIE environment variable

📊 Fetching NFL props...
   🌐 URL: https://api.prizepicks.com/projections?league_id=9&per_page=250
   📋 Headers: {
     "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36...",
     "Accept": "application/json",
     "Referer": "https://app.prizepicks.com/",
     "Cookie": "[REDACTED]"
   }
   🍪 Cookie included: Yes
   ✅ Found 150 NFL props
   ⏳ Waiting 2000ms before next request to avoid rate limiting...
```

## Security Note

Cookie values are automatically redacted in logs as `[REDACTED]` to prevent accidental exposure of credentials.
