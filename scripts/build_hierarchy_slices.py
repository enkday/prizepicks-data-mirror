#!/usr/bin/env python3

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"


def _read_json(path: Path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def _write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _slug(value: str) -> str:
    s = (value or "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s


def build_for_branch(branch: str) -> bool:
    props_path = DATA_DIR / "hierarchy" / branch / "props.json"
    games_path = DATA_DIR / "hierarchy" / branch / "games.json"

    if not props_path.exists() or not games_path.exists():
        return False

    props = _read_json(props_path)
    games = _read_json(games_path)

    # Build a game metadata lookup: gameId -> {sport, slate, startTime, teams}
    game_meta = {}
    for g in games:
        game_id = str(g.get("gameId") or "").strip()
        sport = str(g.get("sport") or "").strip()
        if not game_id or not sport:
            continue

        game_meta[game_id] = {
            "gameId": game_id,
            "sport": sport,
            "slate": g.get("slate"),
            "startTime": g.get("startTime"),
            "teams": g.get("teams"),
        }

    # Group normalized props by sport (standard only)
    props_by_sport = {}
    for p in props:
        if p.get("oddsType") != "standard":
            continue
        sport = str(p.get("sport") or "").strip()
        if not sport:
            continue
        props_by_sport.setdefault(sport, []).append(p)

    out_branch_root = DATA_DIR / "hierarchy" / branch

    for sport, sport_props in props_by_sport.items():
        sport_slug = _slug(sport)
        sport_root = out_branch_root / sport_slug
        by_game = {}
        by_slate = {}

        for p in sport_props:
            game_id = str(p.get("gameId") or "").strip()
            if not game_id:
                continue
            by_game.setdefault(game_id, []).append(p)

            slate = game_meta.get(game_id, {}).get("slate")
            if slate:
                by_slate.setdefault(_slug(str(slate)), []).append(p)

        # Per-game files
        game_dir = sport_root / "props-by-game"
        index_games = []
        for game_id, items in sorted(by_game.items(), key=lambda kv: kv[0]):
            out_path = game_dir / f"{game_id}.json"
            _write_json(out_path, items)

            meta = game_meta.get(game_id, {})
            index_games.append(
                {
                    "gameId": game_id,
                    "slate": meta.get("slate"),
                    "startTime": meta.get("startTime"),
                    "startTimeIso": (items[0].get("startTimeIso") if items else None),
                    "teams": meta.get("teams"),
                    "propCount": len(items),
                    "path": f"/data/hierarchy/{branch}/{sport_slug}/props-by-game/{game_id}.json",
                }
            )

        # Per-slate files
        slate_dir = sport_root / "props-by-slate"
        index_slates = []
        for slate_slug, items in sorted(by_slate.items(), key=lambda kv: kv[0]):
            out_path = slate_dir / f"{slate_slug}.json"
            _write_json(out_path, items)

            index_slates.append(
                {
                    "slate": slate_slug,
                    "propCount": len(items),
                    "path": f"/data/hierarchy/{branch}/{sport_slug}/props-by-slate/{slate_slug}.json",
                }
            )

        index = {
            "sport": sport,
            "sportSlug": sport_slug,
            "dayBranch": branch,
            "gameCount": len(index_games),
            "propCount": len(sport_props),
            "games": sorted(
                index_games,
                key=lambda g: (
                    g.get("startTimeIso") or "",
                    g.get("gameId") or "",
                ),
            ),
            "slates": index_slates,
        }

        _write_json(sport_root / "props-index.json", index)

    return True


def main():
    any_ok = False
    for branch in ("current_day", "tomorrow"):
        ok = build_for_branch(branch)
        any_ok = any_ok or ok

    # Exit 0 even if files missing (e.g., offseason), to avoid breaking the workflow.
    raise SystemExit(0)


if __name__ == "__main__":
    main()
