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

# Apply SystemMind Build snapshots (apply-protection rollback) migration
# idempotently (same pattern — never blocks post-merge).
node scripts/apply-systemmind-build-snapshots-migration.mjs

# Apply SystemMind Legacy Logic Converter (conversion lineage) migration
# idempotently (same pattern — never blocks post-merge).
node scripts/apply-systemmind-conversions-migration.mjs

# Apply notifications + team access (RBAC) migration idempotently (same pattern — never blocks post-merge)
node scripts/apply-notifications-team-access-migration.mjs

# Ensure the atomic industry-preset apply RPC exists (CREATE OR REPLACE — idempotent, never blocks post-merge)
node scripts/apply-industry-preset-atomic-migration.mjs

# Ensure the atomic AccountsMind config-draft activation RPC exists (CREATE OR REPLACE — idempotent, never blocks post-merge)
node scripts/apply-accountsmind-config-atomic-activation-migration.mjs
