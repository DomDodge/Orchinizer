#!/bin/sh
# Deploy to Fly.io. --ha=false keeps it to one machine: rooms live in memory.
set -e
cd "$(dirname "$0")/.."
fly deploy --config server/fly.toml --dockerfile server/Dockerfile --ha=false "$@" .
