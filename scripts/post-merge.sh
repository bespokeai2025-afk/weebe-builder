#!/bin/bash
set -e

npm install --legacy-peer-deps

# Migrations are applied explicitly, not on every merge:
#   node scripts/apply-migration.mjs supabase/migrations/<file>.sql
