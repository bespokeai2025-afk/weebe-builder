#!/bin/bash
set -e

npm install --legacy-peer-deps

# Apply SystemMind Workflow Library migration idempotently.
# Checks all four tables; exits 0 whether tables already exist, credentials
# are missing, or the Management API is unavailable — never blocks post-merge.
node scripts/apply-systemmind-workflow-library-migration.mjs

# Apply AccountsMind metric snapshots migration idempotently (same pattern —
# never blocks post-merge).
node scripts/apply-accountsmind-metric-snapshots-migration.mjs
