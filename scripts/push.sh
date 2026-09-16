#!/usr/bin/env bash
# Chat2Blend — one-shot GitHub push helper
# Usage (Git Bash / PowerShell with git on PATH):
#   bash push.sh                 # push to https://github.com/nanhudev/chat2blend.git
#   bash push.sh <remote-url>    # push to a different remote
set -euo pipefail

REMOTE_URL="${1:-https://github.com/nanhudev/chat2blend.git}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

echo "[c2b] repo   : $REPO_ROOT"
echo "[c2b] remote : $REMOTE_URL"
echo "[c2b] branch : $(git rev-parse --abbrev-ref HEAD)"
echo "[c2b] commits: $(git rev-list --count HEAD)"

if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REMOTE_URL"
else
  git remote add origin "$REMOTE_URL"
fi

git push -u origin main
echo "[c2b] done. open: ${REMOTE_URL%.git}"
