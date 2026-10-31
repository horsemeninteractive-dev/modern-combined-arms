#!/usr/bin/env bash
# Phase 2A.3: capture deployed heap/CPU profiles at fixed elapsed minutes of the
# running 30-minute staging soak. Staging-only evidence tooling; never deployed.
#
#   MP_ACTOR_ID=... MP_NAMESPACE_ID=... MP_EVIDENCE_DIR=staging-evidence/... \
#     bash tools/phase2a3-profile-schedule.sh
#
# Requires CLOUDFLARE_API_TOKEN in the environment.
set -u

actor="${MP_ACTOR_ID:?MP_ACTOR_ID required}"
namespace="${MP_NAMESPACE_ID:?MP_NAMESPACE_ID required}"
dir="${MP_EVIDENCE_DIR:?MP_EVIDENCE_DIR required}"
account="${MP_ACCOUNT_ID:?MP_ACCOUNT_ID required}"
soak_start="${MP_SOAK_START_EPOCH:?MP_SOAK_START_EPOCH required (seconds, ISO parsed)}"

token="${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN required}"
url="https://api.cloudflare.com/client/v4/accounts/${account}/workers/workers/mca-multiplayer-staging/versions/latest/profile"

mkdir -p "$dir"

profile() {
  local kind="$1" label="$2" duration="$3"
  local out="${dir}/${kind}-${label}.pprof"
  local headers="${dir}/${kind}-${label}.headers"
  local status
  status=$(curl -sS -m 90 --request POST "$url" \
    -H "Authorization: Bearer ${token}" \
    -H 'Content-Type: application/json' \
    -D "$headers" \
    --data "{\"duration_ms\":${duration},\"profile_type\":\"${kind}\",\"namespace_id\":\"${namespace}\",\"actor_id\":\"${actor}\"}" \
    --output "$out" -w '%{http_code}')
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ${kind} ${label} http=${status} bytes=$(wc -c < "$out" 2>/dev/null || echo 0)"
  if [ "$kind" = heap ] && [ "$status" = "200" ]; then
    python tools/phase2a2-heap-summary.py "$out" > "${dir}/heap-${label}-summary.json" 2>"${dir}/heap-${label}-summary.err" || true
  elif [ "$kind" = cpu ] && [ "$status" = "200" ]; then
    python tools/phase2a2-pprof-summary.py "$out" > "${dir}/cpu-${label}-summary.json" 2>"${dir}/cpu-${label}-summary.err" || true
  fi
}

wait_until() {
  local target="$1"
  local now
  now=$(date +%s)
  if [ "$target" -gt "$now" ]; then sleep $((target - now)); fi
}

wait_until $((soak_start + 360))
profile heap m6 20000
wait_until $((soak_start + 600))
profile cpu m10 20000
wait_until $((soak_start + 960))
profile heap m16 20000
wait_until $((soak_start + 1560))
profile heap m26 20000
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] schedule complete"
