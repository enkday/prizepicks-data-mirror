#!/usr/bin/env python3

import json
import re
import shutil
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
    if branch not in ("current_day", "tomorrow"):
        raise ValueError("only generated live branches may be rebuilt")
    props_path = DATA_DIR / "hierarchy" / branch / "props.json"
    games_path = DATA_DIR / "hierarchy" / branch / "games.json"

    if not props_path.exists() or not games_path.exists():
        raise FileNotFoundError(f"missing normalized branch inputs: {branch}")

    props = _read_json(props_path)
    games = _read_json(games_path)
    provenance = _read_json(props_path.parent / "provenance.json")
    if not isinstance(props, list) or not isinstance(games, list):
        raise ValueError("normalized tables must be arrays")
    if provenance.get("propCount") != len(props) or provenance.get("gameCount") != len(games):
        raise ValueError("normalized tables do not match provenance counts")
    for p in props:
        game_id = str(p.get("gameId") or "")
        if not re.fullmatch(r"[A-Za-z0-9_-]+", game_id):
            raise ValueError("gameId is unsafe for a generated file path")
        if p.get("sourcePayloadHash") != provenance.get("sourcePayloadHash"):
            raise ValueError("mixed acquisitions in normalized branch")
        if not _slug(str(p.get("sport") or "")):
            raise ValueError("invalid sport slug")
        if not any(g.get("gameId") == game_id for g in games):
            raise ValueError("prop references a missing game")

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
            "startTimeIso": g.get("startTimeIso"),
            "eventTimeVerified": g.get("eventTimeVerified", False),
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

    # Remove only generated sport surfaces, including sports/games that vanished.
    # The five root tables, provenance and archive branch are untouched.
    for old in out_branch_root.iterdir():
        if old.is_dir() and not old.is_symlink() and (
            (old / "props-index.json").is_file()
            or (old / "props-by-game").is_dir()
            or (old / "props-by-slate").is_dir()
        ):
            shutil.rmtree(old)

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
                    "startTimeIso": meta.get("startTimeIso"),
                    "eventTimeVerified": meta.get("eventTimeVerified", False),
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
            "sourcePath": provenance["sourcePath"],
            "sourcePayloadHash": provenance["sourcePayloadHash"],
            "sourceScrapedAt": provenance["sourceScrapedAt"],
            "sourceScrapedDate": provenance.get("sourceScrapedDate"),
            "observedDate": provenance["observedDate"],
            "completeness": provenance["completeness"],
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
    for branch in ("current_day", "tomorrow"):
        build_for_branch(branch)


if __name__ == "__main__":
    main()
