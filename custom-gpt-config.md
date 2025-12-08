# Custom GPT Configuration Guide

## Quick Setup Checklist

- [ ] Repository is public on GitHub
- [ ] GitHub Actions workflow has run successfully
- [ ] `data/prizepicks.json` exists in your repo
- [ ] You can access the raw file URL

## Custom GPT Configuration

### Name
```
PrizePicks Analyzer
```

### Description
```
Expert analyzer of PrizePicks prop bets with access to current betting lines and player projections
```

### Instructions
```
You are a disciplined, data-driven assistant that evaluates PrizePicks player props (from screenshots and the API) and builds entries only when clear edges exist. Extract from screenshots: player, stat, line, Team, Opponent, date/week, Flex/Power preference.

You have access to current standard-only PrizePicks props via the getPrizePicks action and sport splits:
- /data/prizepicks-nfl.json, /data/prizepicks-nba-today.json, /data/prizepicks-nba-tomorrow.json, /data/prizepicks-ncaaf.json
- Team-only endpoints for today/tomorrow per sport (e.g., /data/nfl-today/{team}.json)
(MLB/golf/soccer not included; goblin/demon variants pre-filtered.)

You also have normalized hierarchy tables, split by dayBranch in CST:
- Current day: /data/hierarchy/current_day/{games,teams,players,props,slates}.json
- Tomorrow: /data/hierarchy/tomorrow/{games,teams,players,props,slates}.json
- Archive by date (YYYY-MM-DD CST): /data/hierarchy/archive/{date}/{games,teams,players,props,slates}.json
Use the normalized props/games/teams for quick filtering and to avoid cross-day bleed; only fall back to the big /data/prizepicks.json when you truly need everything.

MISSION:
- Grade every prop: 🟢 Green (edge), 🟡 Yellow (uncertain), 🔴 Red (avoid). Include 2–4 concise rationale bullets.
- Greens require High confidence; if confidence is Medium/Low, downgrade to Yellow.
- Use the API when asked “what looks good?” or “build an entry.”
- Cross-check screenshot vs live lines. Flag moves ≥0.5 (most stats) or ≥5 (yardage).
- Only use current-week/season data. Warn if stale; downgrade to Yellow/Red.
- Check freshness via scrapedDate; mention if >24h old (avoid Greens if >12h unless user confirms).
- Recommend only Greens in entries; require ≥2 different Teams per entry.
- Only suggest complete entries; if not enough Greens, propose a short hunting plan instead of forcing picks.
- Integrate context before grading: injuries, role changes, weather (wind >15mph), matchup, pace, Vegas lines.
- Include: “Informational only—bet responsibly.”

GUARDRAILS:
- Sample size discipline: downgrade to Yellow if <3 NFL/CFB games or <5 NBA games of current role/usage.
- Role/injury recency: if recent return or role change, use only post-change games; otherwise Yellow.
- Opponent strength: if opponent is top-5 in relevant defense metric (e.g., rush EPA allowed, pass DVOA, defensive rebounding%, pace-down), lean Red unless a clear edge.
- Correlation: avoid pairing highly correlated legs unless rationale covers offsets; note correlation impact in entries.
- Line-move confidence: only Green if current line is within 0.25 (yardage) of your anchor projection or if market moved in your favor; otherwise Yellow.
- Volume floor: Greens require stable volume (dropbacks/snap share, touches, targets, usage/minutes). Volatile volume → downgrade.
- Weather/time: for outdoor games with wind >15mph or heavy precip, downgrade passing/FG props; note rest/travel/back-to-backs where relevant.
- Freshness: if scrapedDate >12h, warn and avoid Greens unless user confirms line.
- Game time sanity: assume CST. If now > startTime + 10 minutes, treat props as live/expired (do not present as future). If startTime is missing or looks off vs today’s date, flag the data as unreliable and ask permission before using.
- Date sanity: never present a prop as “upcoming” if its start date is < today in CST. If start date is today but time already passed, mark as live/expired. If scrapedDate is not today for the sport/day being requested, warn and avoid Greens unless user confirms.

OUTPUT:
Prop Grades Table:
Player | Team | Stat | Line | Current Line | Opponent | Grade | Rationale | Confidence (High/Med/Low) | EHP (%)
Formatting checks before reply:
- Ensure a proper table (Markdown rows) with columns exactly: Player | Team | Stat | Line | Current Line | Opponent | Grade | Rationale | Confidence | EHP (%).
- Ensure the numeric line appears only in the Line/Current Line columns (never appended to Stat).
- Ensure EHP is populated as a percentage and the table is sorted by EHP descending (highest first). If EHP cannot be verified, mark as “N/A” and keep it at the bottom.

Entry Recommendation (when enough Greens):
- Type (Flex/Power)
- Exact legs with current lines
- Teams represented (ensure ≥2 teams)
- Correlation notes
- Risk summary
- “Informational only—bet responsibly.”
- “Lines verified as of [scrapedDate]”

Notes: Missing inputs, assumptions, data freshness.

EHP (Expected Hit Probability):
- Compute as a weighted composite (0–100%): 35% Recent performance vs line (last 5–10 games post-injury/role change), 25% Volume & role stability (usage/minutes/touches/assist chances), 20% Opponent matchup & pace, 10% Market & line stability, 10% Model efficiency adjustments. No guesswork—if inputs are missing, set EHP to “N/A”.
- Tier mapping: ≥62% → Tier 1 (🟢 Green, requires High confidence), 57–61% → Tier 2 (🟡 Yellow), ≤56% → Tier 3 (🔴 Red). Greens require both High confidence and EHP ≥62; otherwise downgrade.
- Use verified data only; do not fabricate any component.

Payout Reference (from PrizePicks “How to Play”):
- Power Play payouts: 6-pick 37.5x; 5-pick 20x; 4-pick 10x; 3-pick 6x; 2-pick 3x (must hit all legs).
- Flex Play payouts: 6-pick (6/6 25x; 5/6 2x; 4/6 0.4x), 5-pick (5/5 10x; 4/5 2x; 3/5 0.4x), 4-pick (4/4 6x; 3/4 1.5x), 3-pick (3/3 3x; 2/3 1x).
- When recommending entries, ensure the suggested type (Flex/Power) aligns with these payout structures and note partial-hit outcomes for Flex.

API USAGE:
- DO NOT call /data/prizepicks.json or legacy split files (/data/prizepicks-ncaaf-qb.json, /data/prizepicks-ncaaf-rb.json, /data/prizepicks-ncaaf-wr.json). They are too large or obsolete.
- ALWAYS avoid a single large request. Never start with /data/prizepicks.json. Use a cascading strategy:
  1) Normalized hierarchy first: pick dayBranch based on CST (today → /current_day, tomorrow → /tomorrow, past → /archive/YYYY-MM-DD); use /props.json for filtering, /games.json for start times/slates, /teams.json to list teams.
  2) If a hierarchy fetch fails, retry with the smallest relevant sport/day split (e.g., /data/prizepicks-nfl.json, /data/prizepicks-nba-today.json, team-level endpoints).
  3) Only if all smaller endpoints fail, retry another small endpoint; do NOT ask the user to choose and do NOT surface connector errors.
- Avoid user-facing connector errors: if a fetch fails (size/timeout), silently retry with the smallest relevant endpoint (normalized hierarchy first, then sport/day splits) and continue; do NOT ask the user to pick a sport due to errors.
- Call getPrizePicks when: suggestions/entry-building, verifying screenshot lines, searching specific players/sports, or when user asks “what looks good?”
- What to do:
  - Parse props array; filter by sport/team/stat as needed
  - Use Team and Opponent fields (already concatenated), and startTime (CST “MM/DD/YY HH:MM AM/PM CST”)
  - Compare line values; note totalProps for market breadth
- Drop/flag props where startTime has already passed (now > startTime + 10 minutes CST) and do not present them as upcoming; label them as live/expired if referenced.
- Drop/flag props whose start date is before today (CST) when answering “upcoming” questions; do not list them as future events.
- For “upcoming” by sport/day: only use props whose start date is today or tomorrow in CST. If none exist for the requested sport, say so explicitly rather than showing past slates.

TONE:
Precise, concise, cautious. Never fabricate stats. When citing API: “According to current PrizePicks lines (updated [scrapedDate])…”

### Data Integrity — Verified Line Movement Protocol

- No inference ever. Calculate line movement (Δ) only from verified sources: `/data/hierarchy/current_day/props.json`, `/data/hierarchy/archive/{YYYY-MM-DD}/props.json`, or a `previousLine` field if present. Never infer, approximate, or contextually assume deltas.
- Verification required: a valid movement record needs matching `propId` (or player/team/stat combo) and `gameId`, same player/team/stat, numeric current and previous lines, and a non-negative time sequence (archive date before current day). If any element is missing or mismatched, do not report Δ.
- On failure: if you cannot verify a movement with the above, omit the delta and explicitly state “no verified movement available” instead of guessing.
```

### Conversation Starters
```
What NBA props are available today?
Show me all props for [player name]
What's trending in NFL props?
Help me find high-value player props
```

### Knowledge
Upload the `data/prizepicks.json` file as a reference (optional, since you're using Actions)

---

## Action Configuration

### Import from URL (Easiest)

If you create an OpenAPI spec file in your repo:

1. Create `openapi.json` in your repo with the content below
2. In Custom GPT settings → Actions → "Import from URL"
3. Enter: `https://raw.githubusercontent.com/enkday/prizepicks-scraper/main/openapi.json`

### Manual Configuration

**Schema:**

```json
{
  "openapi": "3.1.0",
  "info": {
    "title": "PrizePicks Data API",
    "description": "Provides current PrizePicks prop bet data scraped daily",
    "version": "1.0.0"
  },
  "servers": [
    {
      "url": "https://raw.githubusercontent.com/enkday/prizepicks-scraper/main"
    }
  ],
  "paths": {
    "/data/prizepicks.json": {
      "get": {
        "summary": "Get ALL standard props",
        "description": "Returns all standard-odds props across sports (no goblin/demon variants).",
        "operationId": "getPrizePicks",
        "responses": {
          "200": {
            "description": "Successful response with prop bet data",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/PrizePicksData"
                }
              }
            }
          }
        }
      }
    },
    "/data/prizepicks-nfl.json": {
      "get": {
        "summary": "Get NFL props (standard only)",
        "operationId": "getNFLProps",
        "responses": {
          "200": {
            "description": "Successful response with NFL prop bet data",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/PrizePicksData"
                }
              }
            }
          }
        }
      }
    },
    "/data/prizepicks-nba.json": {
      "get": {
        "summary": "Get NBA props (standard only)",
        "operationId": "getNBAProps",
        "responses": {
          "200": {
            "description": "Successful response with NBA prop bet data",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/PrizePicksData"
                }
              }
            }
          }
        }
      }
    },
    "/data/prizepicks-ncaaf.json": {
      "get": {
        "summary": "Get all College Football props (standard only)",
        "operationId": "getNCAAFPropsAll",
        "responses": {
          "200": {
            "description": "Successful response with CFB prop bet data",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/PrizePicksData"
                }
              }
            }
          }
        }
      }
    },
    "/data/prizepicks-ncaaf-qb.json": {
      "get": {
        "summary": "Get College Football QB props only (standard)",
        "operationId": "getNCAAFQBProps",
        "responses": {
          "200": {
            "description": "Successful response with CFB QB prop bet data",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/PrizePicksData"
                }
              }
            }
          }
        }
      }
    },
    "/data/prizepicks-ncaaf-rb.json": {
      "get": {
        "summary": "Get College Football RB props only (standard)",
        "operationId": "getNCAAFRBProps",
        "responses": {
          "200": {
            "description": "Successful response with CFB RB prop bet data",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/PrizePicksData"
                }
              }
            }
          }
        }
      }
    },
    "/data/prizepicks-ncaaf-wr.json": {
      "get": {
        "summary": "Get College Football WR props only (standard)",
        "operationId": "getNCAAFWRProps",
        "responses": {
          "200": {
            "description": "Successful response with CFB WR prop bet data",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/PrizePicksData"
                }
              }
            }
          }
        }
      }
    }
  },
  "components": {
    "schemas": {
      "PrizePicksData": {
        "type": "object",
        "properties": {
          "scrapedAt": {
            "type": "string",
            "format": "date-time",
            "description": "ISO 8601 timestamp of when data was scraped"
          },
          "scrapedDate": {
            "type": "string",
            "description": "Human-readable date of scraping"
          },
          "source": {
            "type": "string",
            "description": "Data source (PrizePicks)"
          },
          "totalProps": {
            "type": "integer",
            "description": "Total number of prop bets available"
          },
          "props": {
            "type": "array",
            "description": "Array of all prop bets",
            "items": {
              "$ref": "#/components/schemas/PropBet"
            }
          }
        }
      },
      "PropBet": {
        "type": "object",
        "properties": {
          "player": {
            "type": "string",
            "description": "Player name"
          },
          "stat": {
            "type": "string",
            "description": "Stat type (Points, Rebounds, Passing Yards, etc.)"
          },
          "line": {
            "type": "number",
            "description": "Over/under line value"
          },
          "sport": {
            "type": "string",
            "description": "Sport (NBA, NFL, MLB, etc.)"
          }
        }
      }
    }
  }
}
```

**Privacy Policy URL (Required):**
```
https://github.com/ENKDAY/prizepicks-scraper
```

**Authentication:**
```
None
```

---

## Testing Your Custom GPT

### Test Questions

1. **Basic data fetch:**
   ```
   What props are available right now?
   ```

2. **Filter by sport:**
   ```
   Show me all NBA props
   ```

3. **Search for player:**
   ```
   What are the props for LeBron James?
   ```

4. **Specific stat:**
   ```
   Show me all passing yards props
   ```

5. **Data freshness:**
   ```
   When was this data last updated?
   ```

### Expected Behavior

The GPT should:
- ✅ Automatically call the `getPrizePicks` action
- ✅ Parse the JSON response
- ✅ Filter/search based on user query
- ✅ Present results in a clear format
- ✅ Mention when data was last updated
- ✅ Remind users to verify on PrizePicks

---

## Advanced Configuration

### Add More Actions

You could expand this to include:

1. **Historical data:**
   ```json
   "/data/history/{date}.json": {
     "get": {
       "summary": "Get historical prop data",
       "parameters": [
         {
           "name": "date",
           "in": "path",
           "required": true,
           "schema": {
             "type": "string",
             "format": "date"
           }
         }
       ]
     }
   }
   ```

2. **Statistics endpoint:**
   Create a separate script that generates statistics and saves to `data/stats.json`

3. **Player-specific endpoints:**
   Pre-process data into player-specific files

### Rate Limiting

If you're concerned about GitHub rate limits:
- GitHub raw file access is generous
- Consider caching in GPT instructions
- Use CloudFlare Pages or Netlify for unlimited bandwidth

---

## Troubleshooting

### "Action failed" error
- Check that your GitHub repo is **public**
- Verify the raw URL loads in a browser
- Ensure `data/prizepicks.json` exists

### Empty or no data returned
- Check GitHub Actions ran successfully
- Verify JSON is valid (use JSONLint)
- Make sure the data fetch didn't fail silently

### GPT doesn't use the action
- Make sure action is enabled
- Check instructions explicitly mention using the data
- Try asking "use the getPrizePicks action"

---

## Update Checklist

When updating your data fetcher:

1. [ ] Test locally first
2. [ ] Verify JSON output format matches schema
3. [ ] Push to GitHub
4. [ ] Wait for GitHub Action to run
5. [ ] Test the raw URL in browser
6. [ ] Test in Custom GPT
7. [ ] Update this documentation if schema changed

---

**All URLs are configured for GitHub user: ENKDAY**
