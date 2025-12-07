"""
PrizePicks Normalized Builder v6.0
----------------------------------
Creates normalized tables (games, teams, players, props, slates)
from per-team, standard-only PrizePicks endpoints.

Output:
  ~/prizepicks-scraper/data/hierarchy/{current_day,tomorrow}/
"""
import json
import os
import datetime
import hashlib
from collections import defaultdict

import pytz
import requests


BASE_PATH = os.path.expanduser("~/prizepicks-scraper/data/hierarchy")
CST = pytz.timezone("America/Chicago")

SPORTS = ["NFL"]
SAFE_ODDSTYPE = "standard"

# Default to this repo's data folder; override via DATA_BASE_URL to point elsewhere.
DATA_BASE_URL = os.environ.get(
    "DATA_BASE_URL", "https://raw.githubusercontent.com/ENKDAY/prizepicks-scraper/main/data"
)
DATA_SOURCES = [
    "prizepicks-nfl-today.json",
    "prizepicks-nfl-tomorrow.json",
    "prizepicks-nfl.json",
]


def ensure_dirs():
    for d in ["current_day", "tomorrow"]:
        os.makedirs(os.path.join(BASE_PATH, d), exist_ok=True)


def get_day_branch(dt):
    today = datetime.datetime.now(CST).date()
    if dt.date() == today:
        return "current_day"
    if dt.date() == today + datetime.timedelta(days=1):
        return "tomorrow"
    return None


def classify_slate(dt):
    return "Early" if dt.hour < 15 else "Late"


def parse_time(ts):
    return CST.localize(
        datetime.datetime.strptime(ts.replace(" CST", ""), "%m/%d/%y %I:%M %p")
    )


def clean_key(x):
    return x.lower().replace(" ", "-")


def make_player_id(team, player):
    h = hashlib.sha1(f"{team}_{player}".encode()).hexdigest()[:8]
    return f"{clean_key(team)}_{clean_key(player)}_{h}"


def _load_from_http(url):
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    return r.json().get("props", [])


def _load_from_file(path):
    with open(path) as f:
        return json.load(f).get("props", [])


def fetch_props_sources():
    props = []
    seen = set()
    for name in DATA_SOURCES:
        source_path = os.path.join(DATA_BASE_URL, name)
        try:
            if DATA_BASE_URL.startswith("http"):
                items = _load_from_http(source_path)
            else:
                items = _load_from_file(source_path)
            for p in items:
                if p.get("oddsType", "").lower() != SAFE_ODDSTYPE:
                    continue
                key = (
                    p.get("player"),
                    p.get("stat"),
                    p.get("startTime"),
                    p.get("Team"),
                    p.get("Opponent"),
                )
                if key in seen:
                    continue
                seen.add(key)
                props.append(p)
            print(f"🔗 Loaded {len(items)} props from {source_path}")
        except Exception as e:
            print(f"⚠️  Fetch failed for {source_path}: {e}")
    return props


def normalize_props(props):
    games, teams, players, props_out = {}, {}, {}, []
    slates = defaultdict(lambda: {"gameIds": [], "totalProps": 0})
    for p in props:
        try:
            dt = parse_time(p["startTime"])
        except Exception:
            continue
        day = get_day_branch(dt)
        if not day:
            continue
        slate = classify_slate(dt)
        gid, sport, team, opp, player = (
            p["gameId"],
            p["sport"],
            p["Team"],
            p["Opponent"],
            p["player"],
        )
        line = float(p["line"])

        if gid not in games:
            games[gid] = {
                "gameId": gid,
                "sport": sport,
                "startTime": p["startTime"],
                "teams": [team, opp],
                "slate": slate,
                "dayBranch": day,
            }
            slates[(day, slate)]["gameIds"].append(gid)

        for t in [team, opp]:
            code = clean_key(t)
            teams.setdefault(
                code,
                {
                    "teamCode": code,
                    "teamName": t,
                    "sport": sport,
                },
            )

        pid = make_player_id(team, player)
        players.setdefault(
            pid,
            {
                "playerId": pid,
                "playerName": player,
                "teamCode": clean_key(team),
                "sport": sport,
            },
        )

        props_out.append(
            {
                "propId": f"{gid}_{pid}_{clean_key(p['stat'])}",
                "gameId": gid,
                "playerId": pid,
                "stat": p["stat"],
                "line": line,
                "teamCode": clean_key(team),
                "opponentCode": clean_key(opp),
                "oddsType": SAFE_ODDSTYPE,
                "sport": sport,
                "startTime": p.get("startTime"),
                "startTimeIso": p.get("startTimeIso"),
                "dayBranch": day,
            }
        )
        slates[(day, slate)]["totalProps"] += 1

    slates_list = [{"dayBranch": d, "slate": s, **v} for (d, s), v in slates.items()]
    return games, teams, players, props_out, slates_list


def write_json(path, obj):
    with open(path, "w") as f:
        json.dump(list(obj.values()) if isinstance(obj, dict) else obj, f, indent=2)


def main():
    ensure_dirs()
    all_props = fetch_props_sources()
    games, teams, players, props_out, slates = normalize_props(all_props)

    for branch in ["current_day", "tomorrow"]:
        day_games = {k: v for k, v in games.items() if v["dayBranch"] == branch}
        day_props = [p for p in props_out if games[p["gameId"]]["dayBranch"] == branch]
        day_slates = [s for s in slates if s["dayBranch"] == branch]
        team_codes = set()
        for g in day_games.values():
            for t in g["teams"]:
                team_codes.add(clean_key(t))
        day_teams = {k: v for k, v in teams.items() if k in team_codes}

        player_ids = {p["playerId"] for p in day_props}
        day_players = {pid: players[pid] for pid in player_ids if pid in players}

        write_json(f"{BASE_PATH}/{branch}/games.json", day_games)
        write_json(f"{BASE_PATH}/{branch}/teams.json", day_teams)
        write_json(f"{BASE_PATH}/{branch}/players.json", day_players)
        write_json(f"{BASE_PATH}/{branch}/props.json", day_props)
        write_json(f"{BASE_PATH}/{branch}/slates.json", day_slates)
    print("✅ Normalized hierarchy build complete.")


if __name__ == "__main__":
    main()
