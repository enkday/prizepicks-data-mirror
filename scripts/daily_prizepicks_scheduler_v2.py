"""
Daily PrizePicks Scheduler v2
-----------------------------
Archives /current_day, promotes /tomorrow, rebuilds branches.
"""
import os
import shutil
import datetime
import subprocess
import pytz
import json

BASE = os.path.expanduser("~/prizepicks-scraper/data/hierarchy")
SCRIPT = os.path.expanduser("~/prizepicks-scraper/scripts/build_prizepicks_normalized_v6.py")
CST = pytz.timezone("America/Chicago")


def log(msg):
    ts = datetime.datetime.now(CST).strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] {msg}")


def archive_yesterday():
    today = datetime.datetime.now(CST).date()
    archive_root = os.path.join(BASE, "archive")
    archive_dir = os.path.join(archive_root, str(today))
    current_dir = os.path.join(BASE, "current_day")
    if not os.path.exists(current_dir):
        log("⚠️  No /current_day found.")
        return False
    if not validate_folder(current_dir):
        log("⚠️  /current_day invalid; skipping archive to avoid losing last good copy.")
        return False
    # Keep only one archive: clear any existing archive folders first.
    if os.path.exists(archive_root):
        for entry in os.listdir(archive_root):
            target = os.path.join(archive_root, entry)
            if os.path.isdir(target):
                shutil.rmtree(target)
    os.makedirs(os.path.dirname(archive_dir), exist_ok=True)
    shutil.move(current_dir, archive_dir)
    log(f"📦 Archived to {archive_dir}")
    return True


def validate_folder(path):
    for f in ["games.json", "props.json"]:
        fp = os.path.join(path, f)
        if not os.path.exists(fp):
            return False
        try:
            with open(fp) as fh:
                data = json.load(fh)
            if not data:
                return False
        except Exception:
            return False
    return True


def promote_tomorrow():
    tdir = os.path.join(BASE, "tomorrow")
    cdir = os.path.join(BASE, "current_day")
    if not os.path.exists(tdir):
        log("⚠️  No /tomorrow to promote.")
        return False
    if not validate_folder(tdir):
        log("⚠️  /tomorrow invalid.")
        return False
    shutil.move(tdir, cdir)
    log("🔁 Promoted /tomorrow → /current_day")
    return True


def rebuild_branch(branch):
    env = os.environ.copy()
    env["TARGET_BRANCH"] = branch
    log(f"🚀 Rebuilding {branch}...")
    result = subprocess.run(
        ["python3", SCRIPT],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    if result.returncode == 0:
        log(f"✅ {branch} built.")
    else:
        log(f"❌ Error rebuilding {branch}:\n{result.stdout}")


def main():
    log("🕒 Starting rotation...")
    archive_yesterday()
    if not promote_tomorrow():
        log("🧩 Recovery: rebuild /current_day")
        rebuild_branch("current_day")
    rebuild_branch("tomorrow")
    log("🎯 Rotation complete.")


if __name__ == "__main__":
    main()
