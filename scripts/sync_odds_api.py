"""
Fetch odds from The Odds API for supported sports and store raw snapshots.

This does NOT merge into the normalized hierarchy; it only pulls and saves odds
so they can be joined later. Requires an API key in env ODDS_API_KEY.

Usage:
  python3 scripts/sync_odds_api.py --sports basketball_nba americanfootball_nfl

By default saves to data/odds/{sport_key}.json with a fetchedAt timestamp.
"""
import argparse
import json
import os
import pathlib
import sys
import time
from typing import List

import requests

ODDS_API_KEY = os.environ.get("ODDS_API_KEY")
BASE_URL = "https://api.the-odds-api.com/v4/sports/{sport_key}/odds/"
DEFAULT_SPORTS = ["basketball_nba", "americanfootball_nfl", "americanfootball_ncaaf"]
# Keep markets focused; adjust as needed. The Odds API supports comma-separated list.
DEFAULT_MARKETS = ["player_points", "player_rebounds", "player_assists", "player_pass_yds", "player_rush_yds", "player_rec_yds"]
DEFAULT_REGION = "us"
DEFAULT_ODDS_FORMAT = "american"

OUT_DIR = pathlib.Path("data/odds")


def fetch_odds(sport_key: str, markets: List[str]) -> dict:
    if not ODDS_API_KEY:
        raise RuntimeError("ODDS_API_KEY not set in environment")
    params = {
        "apiKey": ODDS_API_KEY,
        "regions": DEFAULT_REGION,
        "markets": ",".join(markets),
        "oddsFormat": DEFAULT_ODDS_FORMAT,
    }
    url = BASE_URL.format(sport_key=sport_key)
    resp = requests.get(url, params=params, timeout=20)
    resp.raise_for_status()
    data = resp.json()
    return {"fetchedAt": int(time.time()), "sport": sport_key, "markets": markets, "region": DEFAULT_REGION, "odds": data}


def save_snapshot(sport_key: str, payload: dict):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"{sport_key}.json"
    path.write_text(json.dumps(payload, indent=2))
    print(f"Wrote {path}")


def main():
    parser = argparse.ArgumentParser(description="Fetch odds from The Odds API")
    parser.add_argument("--sports", nargs="+", default=DEFAULT_SPORTS, help="Sport keys for The Odds API (e.g., basketball_nba)")
    parser.add_argument("--markets", nargs="+", default=DEFAULT_MARKETS, help="Markets to request (comma-joined for the API)")
    args = parser.parse_args()

    for sport in args.sports:
        try:
            payload = fetch_odds(sport, args.markets)
            save_snapshot(sport, payload)
        except Exception as e:
            print(f"⚠️  Failed for {sport}: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
