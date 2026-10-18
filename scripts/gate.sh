#!/usr/bin/env bash
# Repo gate: serialized verification stages behind a repo-wide lock.
# Usage: scripts/gate.sh [syntax|test|build|e2e]  (default: syntax test build)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
lock_dir="$(git rev-parse --git-common-dir)/gate.lock"

if ! mkdir "$lock_dir" 2>/dev/null; then
  pid="$(cat "$lock_dir/pid" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "gate: another run (pid $pid) holds the lock" >&2
    exit 1
  fi
  echo "gate: taking over stale lock (pid ${pid:-?})" >&2
  rm -rf "$lock_dir"
  mkdir "$lock_dir"
fi
echo $$ >"$lock_dir/pid"
trap 'rm -rf "$lock_dir"' EXIT

# run <label> <timeout-seconds> <command...>
run() {
  local label="$1" secs="$2"
  shift 2
  echo "gate: [$label] $*"
  "$@" &
  local job=$!
  ( sleep "$secs" && kill -9 "$job" 2>/dev/null ) >/dev/null 2>&1 &
  local watchdog=$!
  set +e
  wait "$job"
  local rc=$?
  set -e
  kill "$watchdog" 2>/dev/null || true
  wait "$watchdog" 2>/dev/null || true
  [ "$rc" -eq 0 ] || { echo "gate: [$label] failed (exit $rc)" >&2; exit "$rc"; }
}

case "${1:-}" in
  syntax)
    run syntax 120 npx tsc --noEmit
    run syntax 120 npx astro sync
    run syntax 120 npx astro check
    ;;
  test) run test 120 npx vitest run ;;
  build) run build 120 npx astro build ;;
  e2e) run e2e 600 npx playwright test ;;
  "")
    run syntax 120 npx tsc --noEmit
    run syntax 120 npx astro sync
    run syntax 120 npx astro check
    run test 120 npx vitest run
    run build 120 npx astro build
    ;;
  *) echo "usage: scripts/gate.sh [syntax|test|build|e2e]" >&2; exit 2 ;;
esac
