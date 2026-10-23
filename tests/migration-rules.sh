#!/bin/bash
# Release rules for database changes, run on every pull request (checks.yml):
#   1. a migration already on main is frozen — never edited, renamed or deleted;
#      a change goes in a NEW file
#   2. a new migration's version (its 14-digit name) sorts AFTER the newest one on
#      main, so `supabase db push` applies it in order (an older version would be
#      refused, or applied out of order with --include-all)
#   3. names look like 20261025090000_what_it_does.sql, and no version is used twice
# Production holds versions up to 20261025090000 that were dated ahead of the real
# clock, so until that time passes a new file can't simply take `supabase migration
# new`'s timestamp: name it after the newest one on main.
#   usage: bash tests/migration-rules.sh [base ref, default origin/main]
set -euo pipefail
BASE="${1:-origin/main}"
cd "$(git rev-parse --show-toplevel)"
DIR=supabase/migrations
fail=0
bad(){ echo "::error::$*"; echo "FAIL  $*" >&2; fail=1; }
ver(){ basename "$1" | sed -n 's/^\([0-9]\{14\}\)_[a-z0-9_]*\.sql$/\1/p'; }

newest=$(git ls-tree --name-only "$BASE" "$DIR/" | while read -r f; do ver "$f"; done | sort | tail -1)
[ -n "$newest" ] || { bad "no migrations found on $BASE"; exit 1; }
echo "newest migration on $BASE: $newest"

# what this branch changed under supabase/migrations since it left the base
changes=$(git diff --name-status --no-renames "$BASE"...HEAD -- "$DIR/")
while IFS=$'\t' read -r status path; do
  [ -n "${status:-}" ] || continue
  if [ "$status" != A ]; then
    bad "$path is already on main — a merged migration is never edited, renamed or deleted; put the change in a new file"
    continue
  fi
  v=$(ver "$path")
  if [ -z "$v" ]; then bad "$path: name it like 20261025090000_what_it_does.sql (14 digits, then lower-case words)"; continue; fi
  if [[ ! "$v" > "$newest" ]]; then bad "$path: version $v must be later than the newest on main ($newest)"; continue; fi
  echo "ok    $path (new, $v > $newest)"
done <<< "$changes"

dups=$(ls "$DIR" | sed -n 's/^\([0-9]\{14\}\)_.*/\1/p' | sort | uniq -d)
[ -z "$dups" ] || bad "version used twice in $DIR: $dups"

[ "$fail" = 0 ] && echo "migration rules: OK"
exit $fail
