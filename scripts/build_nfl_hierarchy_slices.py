#!/usr/bin/env python3

"""Deprecated: use scripts/build_hierarchy_slices.py.

Kept for backwards compatibility with any local tooling.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.build_hierarchy_slices import main  # noqa: E402


if __name__ == "__main__":
    main()
