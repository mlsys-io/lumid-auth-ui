#!/usr/bin/env bash
# lum.id/claude pool usage — one script, two surfaces.
#
#   (no args)  one compact line for the Claude Code statusLine
#   --full     detailed report for the /quota slash command
#
# Why this exists: Claude Code's built-in /usage CANNOT show pool usage. Its
# fetchUtilization() bails on `if (!ii() || !bH()) return {}` — both guards test
# OAuth subscription scopes — and even past that it calls claude.ai's
# /api/oauth/usage, not ANTHROPIC_BASE_URL. Gateway users have no OAuth session,
# so /usage is structurally out of reach. These two surfaces are the reachable ones.
#
# Auth: reuses the PAT you already export as ANTHROPIC_AUTH_TOKEN. The
# /me/claude-usage endpoint authenticates the user and needs NO extra scope
# (claude:proxy gates only the proxy route itself).
set -uo pipefail

TOKEN="${LUMID_PAT:-${ANTHROPIC_AUTH_TOKEN:-}}"
BASE="${LUMID_BASE_URL:-https://lum.id}"
MODE="${1:-line}"

# Statusline runs on every render, so never block and never print an error there.
if [ -z "$TOKEN" ]; then
  [ "$MODE" = "--full" ] && echo "No token. Export ANTHROPIC_AUTH_TOKEN (or LUMID_PAT) with a lum.id PAT."
  exit 0
fi

CACHE="${TMPDIR:-/tmp}/lumid-pool-usage.$(id -u).json"
TTL="${LUMID_POOL_TTL:-60}"
[ "$MODE" = "--full" ] && TTL=0          # /quota is explicit — always fetch fresh

age=$(( $(date +%s) - $(stat -c %Y "$CACHE" 2>/dev/null || echo 0) ))
if [ ! -s "$CACHE" ] || [ "$age" -ge "$TTL" ]; then
  if curl -sf --max-time "$([ "$MODE" = "--full" ] && echo 8 || echo 2)" \
       -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/me/claude-usage" \
       -o "$CACHE.$$" 2>/dev/null; then
    mv -f "$CACHE.$$" "$CACHE"
  else
    rm -f "$CACHE.$$"
    if [ "$MODE" = "--full" ]; then
      echo "Could not reach $BASE/api/v1/me/claude-usage (network, or PAT invalid/revoked)."
      exit 0
    fi
    [ -s "$CACHE" ] || exit 0             # serve stale, else stay silent
  fi
fi

python3 - "$CACHE" "$MODE" <<'PY' 2>/dev/null
import json, sys, datetime

try:
    d = json.load(open(sys.argv[1]))["data"]
except Exception:
    sys.exit(0)
full = sys.argv[2] == "--full"

def pct(u, c): return (u / c * 100.0) if c else 0.0
t5, c5 = d.get("five_hour_tokens", 0), d.get("cap_5h", 0)
t7, c7 = d.get("seven_day_tokens", 0), d.get("cap_7d", 0)
p5, p7 = pct(t5, c5), pct(t7, c7)

def reset_in(ts):
    # Zero value = no usage yet in the window, so there is no reset to show.
    if not ts or ts.startswith("0001-01-01"):
        return ""
    try:
        t = datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return ""
    m = (t - datetime.datetime.now(datetime.timezone.utc)).total_seconds() / 60
    if m <= 0:
        return ""
    return f"{int(m//60)}h{int(m%60):02d}m" if m >= 60 else f"{int(m)}m"

def col(p): return "31" if p >= 90 else "33" if p >= 70 else "36"

if not full:
    r = reset_in(d.get("five_hour_reset", ""))
    print(f"\033[{col(max(p5,p7))}m⧉ pool {p5:.0f}%/5h{' ↺'+r if r else ''}"
          f" · {p7:.0f}%/7d\033[0m")
    sys.exit(0)

def bar(p, w=28):
    fill = min(int(round(p / 100 * w)), w)
    return f"\033[{col(p)}m{'█'*fill}\033[0m{'░'*(w-fill)}"

def n(x):
    return f"{x/1_000_000:.2f}M" if x >= 1_000_000 else f"{x/1_000:.0f}k" if x >= 1_000 else str(x)

print("lum.id/claude — your pool usage\n")
for label, p, used, cap, rs in (
    ("5h ", p5, t5, c5, d.get("five_hour_reset", "")),
    ("7d ", p7, t7, c7, d.get("seven_day_reset", "")),
):
    r = reset_in(rs)
    print(f"  {label} {bar(p)} {p:5.1f}%   {n(used)} / {n(cap)}"
          + (f"   resets in {r}" if r else ""))

models = d.get("models") or {}
if models:
    print("\n  by model (7d)")
    rows = sorted(models.items(),
                  key=lambda kv: -(kv[1].get("tokens", 0) if isinstance(kv[1], dict) else kv[1] or 0))
    for name, v in rows[:8]:
        tok = v.get("tokens", 0) if isinstance(v, dict) else (v or 0)
        print(f"    {name:<34} {n(tok):>8}")

reqs = d.get("requests_7d", 0)
cost = d.get("cost_cents_7d", 0)
extra = f"  ·  ${cost/100:.2f}" if cost else ""
print(f"\n  {reqs} requests over 7d{extra}")
print("\n  Caps are per-user, rolling (not calendar) windows. Full dashboard: lum.id/code")
PY
