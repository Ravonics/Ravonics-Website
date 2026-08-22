#!/usr/bin/env bash
# inject-endpoints.sh
#
# Publish-time endpoint injection for the Ravonics web forms.
#
# The source HTML in this repo is a correct CONSUMER of
# window.RAVONICS_FORM_ENDPOINTS but deliberately ships NO endpoint secrets.
# This script runs against the gh-pages publish WORKTREE (a derived artifact)
# and:
#   1. Determines the endpoint URLs for each form (see MODES below).
#   2. Writes <worktree>/js/form-endpoints.js defining
#      window.RAVONICS_FORM_ENDPOINTS = { contact, booking, capability_update }.
#   3. Injects a <script src> include before </head> in the worktree copies of
#      contact.html, booking.html and company/doing-business.html.
#
# MODE
# ----
# Proxy mode only:
#   Writes the lead-capture PROXY endpoints instead of the raw SAS URLs, so the
#   SAS never reaches the browser. No Azure call is made; no secret is written.
#   Requires RAVONICS_PROXY_BASE, e.g.
#     RAVONICS_PROXY_BASE="https://ravonicsapi-adcah9bdahb4hca0.z02.azurefd.net/api"
#   Each form maps to a path route: <base>/lead/<form>. The forms must also send
#   a Cloudflare Turnstile token (cf_turnstile_token) + a company_website
#   honeypot field; that markup is handled separately (see proxy/README.md).
#
# Direct Logic App/SAS endpoint injection is intentionally disabled. The proxy
# is the only supported endpoint contract, and scripts/ is on the gh-pages
# publish exclude list, so this script itself never ships.
#
# Usage:
#   ./scripts/inject-endpoints.sh /tmp/ghpages-work
#   RAVONICS_PROXY_BASE="https://<FRONT-DOOR-API-ENDPOINT>.azurefd.net/api" \
#     ./scripts/inject-endpoints.sh /tmp/ghpages-work
#
# Exit codes:
#   0  — success: form-endpoints.js written and includes injected
#   1+ — failure: unsupported mode, bad proxy URL, or bad worktree

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# The lead-capture proxy (ravonics-lead-proxy) keeps Logic App credentials out
# of the browser. RAVONICS_USE_PROXY is retained only as a fail-closed guard so
# old callers cannot silently re-enable direct endpoint injection.
PROXY_BASE="${RAVONICS_PROXY_BASE:-https://ravonicsapi-adcah9bdahb4hca0.z02.azurefd.net/api}"

# ---------------------------------------------------------------------------
# Arg handling
# ---------------------------------------------------------------------------

if [[ $# -lt 1 ]]; then
  echo "ERROR: missing worktree argument." >&2
  echo "Usage: $0 <gh-pages-worktree-dir>" >&2
  exit 2
fi

WORKTREE="$1"

if [[ ! -d "${WORKTREE}" ]]; then
  echo "ERROR: worktree directory does not exist: ${WORKTREE}" >&2
  exit 2
fi

WORKTREE="$(cd "${WORKTREE}" && pwd)"

# Sanity: the worktree must look like the site root (the consumer pages must be present).
for required in "contact.html" "booking.html" "company/doing-business.html"; do
  if [[ ! -f "${WORKTREE}/${required}" ]]; then
    echo "ERROR: ${WORKTREE} does not look like the site root (missing ${required})." >&2
    exit 2
  fi
done

# ---------------------------------------------------------------------------
# Resolve proxy endpoint URLs
# ---------------------------------------------------------------------------
if [[ "${RAVONICS_USE_PROXY:-1}" != "1" ]]; then
  echo "ERROR: only proxy mode is supported; direct endpoint injection is disabled." >&2
  exit 6
fi

if [[ -z "${PROXY_BASE}" ]]; then
  echo "ERROR: RAVONICS_PROXY_BASE is unset." >&2
  echo "       e.g. RAVONICS_PROXY_BASE=https://<FRONT-DOOR-API-ENDPOINT>.azurefd.net/api" >&2
  exit 6
fi
if [[ "${PROXY_BASE}" != https://* ]]; then
  echo "ERROR: RAVONICS_PROXY_BASE must be an https:// URL (got '${PROXY_BASE}')." >&2
  exit 6
fi
# Strip any trailing slash for clean concatenation.
PROXY_BASE="${PROXY_BASE%/}"

CONTACT_URL="${PROXY_BASE}/lead/contact"
BOOKING_URL="${PROXY_BASE}/lead/booking"
CAPABILITY_URL="${PROXY_BASE}/lead/capability_update"
echo "Proxy mode: endpoints point at ${PROXY_BASE}/lead/*" >&2

# ---------------------------------------------------------------------------
# Write js/form-endpoints.js into the worktree
# ---------------------------------------------------------------------------
# contact and booking share the consultation intake flow. capability_update
# uses the dedicated nurture flow. careers is intentionally omitted (no backend
# Logic App) so it gracefully stays on the mailto fallback.

mkdir -p "${WORKTREE}/js"
ENDPOINTS_FILE="${WORKTREE}/js/form-endpoints.js"

cat > "${ENDPOINTS_FILE}" <<EOF
/**
 * Ravonics form endpoints (deploy-time generated; NOT in source control).
 *
 * Injected by scripts/inject-endpoints.sh at publish time. These are the
 * lead-capture proxy paths; Logic App credentials never reach the browser.
 * careers is intentionally absent (no backend) so that form stays on its
 * mailto fallback.
 */
window.RAVONICS_FORM_ENDPOINTS = {
  contact: "${CONTACT_URL}",
  booking: "${BOOKING_URL}",
  capability_update: "${CAPABILITY_URL}"
};
EOF

echo "Wrote ${ENDPOINTS_FILE}" >&2

# ---------------------------------------------------------------------------
# Inject the <script src> include before </head> (idempotent)
# ---------------------------------------------------------------------------
# Each page gets a path-correct src. The include must load BEFORE the inline
# form scripts (which run on DOMContentLoaded), so injecting in <head> is safe.

inject_include() {
  local page="$1"      # path relative to worktree
  local src="$2"       # value for the script src attribute
  local file="${WORKTREE}/${page}"
  local tag="<script src=\"${src}\"></script>"

  if [[ ! -f "${file}" ]]; then
    echo "ERROR: cannot inject into missing file: ${file}" >&2
    exit 5
  fi

  # Idempotency: skip if this exact include is already present.
  if grep -qF "${tag}" "${file}"; then
    echo "Already injected in ${page} (skipping)." >&2
    return 0
  fi

  # Insert the tag on its own line immediately before the first </head>.
  # awk keeps this precise (first occurrence only) and avoids sed quoting pain.
  local tmp
  tmp="$(mktemp)"
  awk -v tag="    ${tag}" '
    !done && /<\/head>/ { print tag; done=1 }
    { print }
  ' "${file}" > "${tmp}"

  # Verify the insertion actually happened before overwriting.
  if ! grep -qF "${tag}" "${tmp}"; then
    rm -f "${tmp}"
    echo "ERROR: failed to inject include into ${page} (no </head> found?)." >&2
    exit 5
  fi

  mv "${tmp}" "${file}"
  echo "Injected include into ${page}." >&2
}

inject_include "contact.html"               "js/form-endpoints.js"
inject_include "booking.html"               "js/form-endpoints.js"
inject_include "company/doing-business.html" "../js/form-endpoints.js"

echo "Endpoint injection complete." >&2
exit 0
