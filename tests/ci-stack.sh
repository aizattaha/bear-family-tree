#!/bin/bash
# Starts a THROWAWAY local Supabase with every migration in supabase/migrations/,
# production's grants mirrored first (tests/prod-grants.sql), then prints the
# settings the tests need. Used by .github/workflows/checks.yml; runs on a Mac too.
#   usage: bash tests/ci-stack.sh <empty folder> [port prefix, default 543]
# Never points at production: it only ever starts containers on this machine.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$1"; P="${2:-543}"
mkdir -p "$DIR/supabase/migrations"
cat > "$DIR/supabase/config.toml" <<EOF
project_id = "bft_ci"
[api]
port = ${P}21
max_rows = 1000
[db]
port = ${P}22
shadow_port = ${P}20
major_version = 17
[studio]
enabled = false
[auth]
site_url = "http://127.0.0.1:8865/"
[auth.email]
enable_confirmations = false
EOF
cp "$REPO/tests/prod-grants.sql" "$DIR/supabase/migrations/20260101000000_test_prod_grants.sql"
cp "$REPO"/supabase/migrations/*.sql "$DIR/supabase/migrations/"
supabase start --workdir "$DIR" \
  -x realtime,storage-api,imgproxy,studio,edge-runtime,logflare,vector,supavisor,postgres-meta,mailpit
env=$(supabase status -o env --workdir "$DIR")
val(){ echo "$env" | sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}$/\1/p"; }
out="SUPABASE_URL=$(val API_URL)
SUPABASE_KEY=$(val PUBLISHABLE_KEY)
DB_CONTAINER=supabase_db_bft_ci"
echo "$out"
if [ -n "${GITHUB_ENV:-}" ]; then echo "$out" >> "$GITHUB_ENV"; fi
