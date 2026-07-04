#!/usr/bin/env bash
# Interactive production deploy for acorn.
# Walks the README checklist: create D1 + KV, patch wrangler.jsonc, set secrets,
# migrate --remote, build + deploy. Each step is y/N gated so re-runs skip done work.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../apps/desktop" && pwd)"
CONFIG="$APP_DIR/wrangler.jsonc"
cd "$APP_DIR"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
die()  { printf '\033[31mError: %s\033[0m\n' "$1" >&2; exit 1; }
confirm() { read -rp "$1 [y/N] " a; [[ "$a" =~ ^[Yy]$ ]]; }

# Swap a unique placeholder string for a real id, then verify the swap took.
patch_config() {
  local placeholder="$1" id="$2" label="$3"
  grep -q "$placeholder" "$CONFIG" || die "placeholder for $label not found in $CONFIG (already patched?)"
  sed -i.bak "s/$placeholder/$id/" "$CONFIG" && rm -f "$CONFIG.bak"
  grep -q "$id" "$CONFIG" || die "failed to write $label id into $CONFIG"
  grep -q "$placeholder" "$CONFIG" && die "placeholder for $label still present after patch"
  bold "  → $label id written to wrangler.jsonc"
}

# Run a create command, try to auto-extract the id, fall back to manual paste.
# Only the id goes to stdout; all diagnostics go to stderr so $(...) captures just the id.
create_resource() {
  local label="$1" regex="$2"; shift 2
  local out id
  bold "Creating $label …" >&2
  out="$("$@" 2>&1)" || true
  printf '%s\n' "$out" >&2
  id="$(printf '%s' "$out" | grep -oE "$regex" | head -n1 || true)"
  if [[ -z "$id" ]]; then
    echo "Could not auto-detect the $label id from the output above." >&2
    read -rp "Paste the $label id: " id </dev/tty
  fi
  [[ -n "$id" ]] || die "no $label id provided"
  echo "$id"
}

# --- Preflight ---------------------------------------------------------------
command -v pnpm    >/dev/null || die "pnpm not found"
command -v openssl >/dev/null || die "openssl not found"
pnpm wrangler whoami >/dev/null 2>&1 || die "not logged in — run: pnpm wrangler login"
bold "Authenticated with Cloudflare. Deploying from $APP_DIR"

# --- Resources + config ------------------------------------------------------
if confirm "Create D1 + KV namespaces and patch wrangler.jsonc?"; then
  db_id="$(create_resource "D1 database" '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' \
            pnpm wrangler d1 create acorn)"
  patch_config '00000000-0000-0000-0000-000000000000' "$db_id" "D1"

  blobs_id="$(create_resource "BLOBS KV" '[0-9a-f]{32}' \
              pnpm wrangler kv namespace create BLOBS)"
  patch_config '00000000000000000000000000000001' "$blobs_id" "BLOBS"

  oauth_id="$(create_resource "OAUTH_STATE KV" '[0-9a-f]{32}' \
              pnpm wrangler kv namespace create OAUTH_STATE)"
  patch_config '00000000000000000000000000000000' "$oauth_id" "OAUTH_STATE"
fi

# --- Secrets -----------------------------------------------------------------
if confirm "Set production secrets?"; then
  read -rp  "GITHUB_CLIENT_ID: " gh_id
  echo "$gh_id" | pnpm wrangler secret put GITHUB_CLIENT_ID

  read -rsp "GITHUB_CLIENT_SECRET: " gh_secret; echo
  echo "$gh_secret" | pnpm wrangler secret put GITHUB_CLIENT_SECRET

  key="$(openssl rand -hex 32)"
  if confirm "Use an auto-generated SESSION_ENC_KEY? (no = paste your own)"; then
    :
  else
    while true; do
      read -rsp "SESSION_ENC_KEY (64 hex chars): " key; echo
      [[ "$key" =~ ^[0-9a-fA-F]{64}$ ]] && break
      echo "Must be exactly 64 hex characters (openssl rand -hex 32)."
    done
  fi
  echo "$key" | pnpm wrangler secret put SESSION_ENC_KEY
fi

# --- Migrate -----------------------------------------------------------------
if confirm "Apply D1 migrations to production (--remote)?"; then
  pnpm wrangler d1 migrations apply acorn --remote
fi

# --- Build + deploy ----------------------------------------------------------
if confirm "Build and deploy the Worker?"; then
  pnpm --filter @acorn/desktop build
  pnpm wrangler deploy
fi

cat <<'EOF'

Done. Reminder:
  • Register a PRODUCTION GitHub OAuth App with callback
    https://<your-deployed-domain>/auth/callback
  • The GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET you entered must be that app's
    (the dev app at localhost:5173 is separate).
EOF
