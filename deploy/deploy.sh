#!/usr/bin/env bash
set -euo pipefail

HOST="${1:-sv-dev}"
REMOTE_ROOT=/opt/bragi-router
TS=$(date -u +%Y%m%d-%H%M%S)
RELEASE_DIR="$REMOTE_ROOT/releases/$TS"

cd "$(dirname "$0")/../server"

echo "== install =="
pnpm install --frozen-lockfile

echo "== typecheck =="
pnpm typecheck

echo "== test =="
pnpm test

echo "== build =="
pnpm build

echo "== upload =="
ssh "$HOST" "mkdir -p $RELEASE_DIR"
rsync -az --delete dist/ "$HOST:$RELEASE_DIR/dist/"
rsync -az package.json pnpm-lock.yaml "$HOST:$RELEASE_DIR/"

echo "== install prod deps on remote =="
ssh "$HOST" "cd $RELEASE_DIR && pnpm install --prod --frozen-lockfile"

echo "== symlink current =="
ssh "$HOST" "ln -sfn $RELEASE_DIR $REMOTE_ROOT/current"

echo "== restart =="
ssh "$HOST" "sudo systemctl restart bragi-router && sudo systemctl status bragi-router --no-pager"

echo "== health =="
sleep 2
ssh "$HOST" "curl -fsS http://127.0.0.1:8787/v1/health" | jq .

echo "== done =="
