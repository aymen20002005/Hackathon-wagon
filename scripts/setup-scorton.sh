#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

[ -d vendor/scortonjs ] || git clone --depth 1 https://github.com/scorton/scortonjs.git vendor/scortonjs
python3 -m venv .venv
.venv/bin/pip install --quiet requests
echo "ScortonJS ready in vendor/scortonjs (python deps in .venv)."
