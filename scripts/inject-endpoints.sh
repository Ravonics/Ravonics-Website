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
# MODES
# -----
# Direct mode (RAVONICS_USE_PROXY=0, legacy):
#   Retrieves the Azure Logic App SAS callback URLs at runtime and writes them
#   into form-endpoints.js. This exposes the SAS sig in client JS (the original,
#   inherent limitation). Used when no proxy is configured.
#
# Proxy mode (default now, since 2026-06-22):
#   Writes the lead-capture PROXY endpoints instead of the raw SAS URLs, so the
#   SAS never reaches the browser. No Azure call is made; no secret is written.
#   Requires RAVONICS_PROXY_BASE, e.g.
#     RAVONICS_PROXY_BASE="https://ravonics-lead-proxy.azurewebsites.net/api"
#   Each form maps to a path route: <base>/lead/<form>. The forms must also send
#   a Cloudflare Turnstile token (cf_turnstile_token) + a company_website
#   honeypot field; that markup is handled separately (see proxy/README.md).
#
# Secrets (SAS callback URLs) are ONLY ever written into the worktree, and only
# in direct mode. scripts/ is on the gh-pages publish exclude list, so this
# script itself never ships.
#
# Usage:
#   ./scripts/inject-endpoints.sh /tmp/ghpages-work                  # proxy (default)
#   RAVONICS_USE_PROXY=0 ./scripts/inject-endpoints.sh /tmp/ghpages-work  # direct SAS
#
# Exit codes:
#   0  — success: form-endpoints.js written and includes injected
#   1+ — failure: az not logged in, callback URL not retrievable, or bad worktree

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SUBSCRIPTION="6e60a8fd-9992-4ff7-8a3e-db96b4dfed4f"   # Microsoft Partner Network
RESOURCE_GROUP="FocusPass"
API_VERSION="2016-06-01"

# Workflow name -> trigger name. Both flows expose a single "manual" HTTP trigger.
CONSULTATION_WF="Ravonics_Consultation_Intake"        # contact + booking
CAPABILITY_WF="Ravonics_CapabilityUpdate_Intake"      # capability_update
TRIGGER_NAME="manual"

# Proxy mode toggles (see MODES in the header).
# Default: proxy mode.  The lead-capture proxy (ravonics-lead-proxy) keeps the
# Logic App SAS out of the browser.  Override with RAVONICS_USE_PROXY=0 to fall
# back to direct Azure SAS callback URLs (legacy).
USE_PROXY="${RAVONICS_USE_PROXY:-1}"
PROXY_BASE="${RAVONICS_PROXY_BASE:-https://ravonics-lead-proxy.azurewebsites.net/api}"

# ---------------------------------------------------------------------------
# Stale-SAS guard (2026-06-22 rotation)
# ---------------------------------------------------------------------------
# The old SAS signatures were burned when an earlier version of
# form-endpoints.js was committed to a public GitHub mirror.  They were
# rotated on 2026-06-22 via regenerateAccessKey on both Logic Apps.
#
#   Consultation (old sig):
#     mj6El6caqZ0C0PSYVMswT25WYZ7yVZZNtNLLXC8CVrs
#   Capability (old sig):
#     MHS-OOwgWMSCU5JTZHLec2LPfVswzvNUYBvYeRbPSl4
#
# Both Logic App access keys (primary) have been regenerated, permanently
# invalidating all SAS derived from the old keys.  Direct mode retrieves
# fresh callback URLs on-the-fly via get_callback_url().  Do NOT revert to
# the old sig values.
# ---------------------------------------------------------------------------

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
# Resolve endpoint URLs (proxy mode vs direct/SAS mode)
# ---------------------------------------------------------------------------
# Sets CONTACT_URL / BOOKING_URL / CAPABILITY_URL. In direct mode contact and
# booking share the consultation SAS URL. In proxy mode each maps to a proxy
# path route.

if [[ "${USE_PROXY}" == "1" ]]; then
  # ---- Proxy mode: no Azure call, no secret written ----
  if [[ -z "${PROXY_BASE}" ]]; then
    echo "ERROR: RAVONICS_USE_PROXY=1 but RAVONICS_PROXY_BASE is unset." >&2
    echo "       e.g. RAVONICS_PROXY_BASE=https://ravonics-lead-proxy.azurewebsites.net/api" >&2
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

else
  # ---- Direct mode (legacy): retrieve the SAS callback URLs from Azure ----
  if ! command -v az >/dev/null 2>&1; then
    echo "ERROR: az CLI not found on PATH." >&2
    exit 3
  fi

  if ! az account show >/dev/null 2>&1; then
    echo "ERROR: az is not logged in. Run 'az login' first." >&2
    exit 3
  fi

  # Retrieve a Logic App callback URL (fails loudly on any problem).
  get_callback_url() {
    local workflow="$1"
    local url
    url="$(az rest \
      --method post \
      --url "https://management.azure.com/subscriptions/${SUBSCRIPTION}/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.Logic/workflows/${workflow}/triggers/${TRIGGER_NAME}/listCallbackUrl?api-version=${API_VERSION}" \
      --query "value" -o tsv 2>/dev/null || true)"

    # Must be a real HTTPS callback URL carrying a signature.
    if [[ "${url}" != https://*"sig="* ]]; then
      echo "ERROR: could not retrieve a valid callback URL for ${workflow}." >&2
      echo "       (az returned: '${url:-<empty>}')" >&2
      exit 4
    fi

    printf '%s' "${url}"
  }

  echo "Retrieving Logic App callback URLs..." >&2
  CONSULTATION_URL="$(get_callback_url "${CONSULTATION_WF}")"
  CAPABILITY_URL="$(get_callback_url "${CAPABILITY_WF}")"

  # Defense in depth: refuse to proceed if anything came back empty.
  if [[ -z "${CONSULTATION_URL}" || -z "${CAPABILITY_URL}" ]]; then
    echo "ERROR: one or more callback URLs are empty; refusing to write placeholders." >&2
    exit 4
  fi

  CONTACT_URL="${CONSULTATION_URL}"
  BOOKING_URL="${CONSULTATION_URL}"
fi

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
 * Injected by scripts/inject-endpoints.sh at publish time. In proxy mode these
 * are the lead-capture proxy paths (no SAS in the browser). In direct mode they
 * are the Azure Logic App SAS callback URLs. careers is intentionally absent
 * (no backend) so that form stays on its mailto fallback.
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
