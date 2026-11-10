#!/usr/bin/env bash
# Spins up a throwaway Postgres 16, applies migrations twice (idempotency), seeds, runs tests.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE/.."
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
DATA="$(mktemp -d)"
RUNAS=()
if [ "$(id -u)" = 0 ]; then U="${PG_RUNAS:-postgres}"; chown "$U" "$DATA"; RUNAS=(runuser -u "$U" --); fi
PORT="${PGPORT_TEST:-54329}"
trap '"${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$DATA" stop -m fast >/dev/null 2>&1 || true; rm -rf "$DATA"' EXIT
"${RUNAS[@]}" "$PGBIN/initdb" -D "$DATA" -U postgres -A trust >/dev/null
"${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k /tmp" -l "$DATA/log" start >/dev/null
sleep 1
PSQL=(psql -h /tmp -p "$PORT" -U postgres -q -v ON_ERROR_STOP=1)
"${PSQL[@]}" -c "create database rida_test" >/dev/null
"${PSQL[@]}" -d rida_test -f "$HERE/shim.sql"
for pass in 1 2; do
  for f in "$ROOT"/migrations/*.sql; do "${PSQL[@]}" -d rida_test -f "$f"; done
done
"${PSQL[@]}" -d rida_test -f "$ROOT/seed.sql"
"${PSQL[@]}" -d rida_test -f "$ROOT/seed.sql"
"${PSQL[@]}" -d rida_test -f "$HERE/matching_and_rls.test.sql"
