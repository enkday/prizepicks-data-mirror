# PrizePicks Data Mirror

This repo publishes PrizePicks prop data as raw JSON so clients can consume it via GitHub-hosted URLs. No GPT setup guidance is included—use these endpoints however you like.

## What’s published
- Aggregated sport feeds: `data/prizepicks-nfl.json`, `data/prizepicks-nba-today.json`, `data/prizepicks-nba-tomorrow.json`, `data/prizepicks-ncaaf.json`.
- Normalized hierarchy (CST day buckets): `data/hierarchy/current_day|tomorrow/{games,teams,players,props,slates}.json` and archived days under `data/hierarchy/archive/YYYY-MM-DD/`.
- Payout reference: `docs/prizepicks-payouts.md` (Power vs Flex multipliers).

Raw URLs follow the pattern:
```
https://raw.githubusercontent.com/ENKDAY/prizepicks-scraper/main/<path>
```
Example: `https://raw.githubusercontent.com/ENKDAY/prizepicks-scraper/main/data/hierarchy/current_day/props.json`

## Scripts
- `scripts/build_prizepicks_normalized_v6.py`: builds the normalized hierarchy from sport JSONs.
- `scripts/daily_prizepicks_scheduler_v2.py`: rotates archive/current/tomorrow, then rebuilds.
- `scripts/sync_prizepicks_payouts.py`: refreshes `docs/prizepicks-payouts.md` from the official PrizePicks “How to Play” page.

## Local usage
```
python3 scripts/build_prizepicks_normalized_v6.py
python3 scripts/daily_prizepicks_scheduler_v2.py
python3 scripts/sync_prizepicks_payouts.py
```

## Notes
- Times are CST in the hierarchy files.
- Only standard-odds props are included; goblin/demon variants are excluded.
- If you need a different cadence or sports, adjust the data sources in `scripts/build_prizepicks_normalized_v6.py` and the scheduler as needed.

## Scraper Features

The `scraper.js` script includes several features to handle API restrictions:

- **Rate limiting protection**: 2-second delay between league requests to avoid 429 errors
- **Randomized User-Agents**: Rotates through 6 realistic browser UA strings
- **Cookie support**: Set `PRIZEPICKS_COOKIE` environment variable for authentication
- **Enhanced logging**: Logs URLs, headers (with sensitive data redacted), and detailed errors

For troubleshooting API issues (403/429 errors), see [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
