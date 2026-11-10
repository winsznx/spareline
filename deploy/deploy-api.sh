#!/usr/bin/env bash
# Sync the API source to the VPS and rebuild only the api service.
# Server-only files (deploy/api.env, deploy/secrets/) are excluded and protected from --delete.
# Usage: SPARELINE_SSH_HOST=<ssh alias> deploy/deploy-api.sh
set -euo pipefail
HOST="${SPARELINE_SSH_HOST:?set SPARELINE_SSH_HOST to your ssh host alias}"
REMOTE="${SPARELINE_REMOTE_DIR:-/home/ubuntu/spareline}"
cd "$(dirname "$0")/.."
rsync -az --delete \
  --filter='P deploy/api.env' --filter='P deploy/secrets/' \
  --exclude '.venv' --exclude '__pycache__' --exclude '.pytest_cache' --exclude '.ruff_cache' \
  -R services/api data/processed evaluations deploy/api.Dockerfile deploy/compose.yml .dockerignore \
  "$HOST:$REMOTE/"
ssh "$HOST" "cd $REMOTE/deploy && docker compose up -d --build api && docker compose ps"
