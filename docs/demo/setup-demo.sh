#!/usr/bin/env bash
set -euo pipefail

rm -rf docs/demo/workspace
mkdir -p docs/demo/workspace/logs
cd docs/demo/workspace

git init >/dev/null
git config user.email tracepad@example.com
git config user.name Tracepad

cat > package.json <<'JSON'
{"scripts":{"test":"node test.js"}}
JSON

cat > test.js <<'JS'
throw new Error("checkout timeout")
JS

cat > logs/server.log <<'LOG'
INFO boot
Error: checkout timeout after deploy
Caused by: HTTP/1.1" 503
INFO retry scheduled
LOG

git add .
git commit -m init >/dev/null
