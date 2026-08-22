# Ravonics lead-capture proxy

Thin **Azure Functions** (Node 24+, v4 programming model) proxy that sits in
front of the Ravonics D365 **Logic App** intake flows. It exists so the Logic
App SAS callback URLs (`...&sig=...`) never reach the browser, and so we get
CAPTCHA, rate limiting, and basic spam filtering on the public forms.

This project deploys on Node.js 24 (`engines.node >=24 <27`). Node.js 26 is
covered by the repository's compatibility lane, but is not the production
runtime until Azure Functions lists it as supported and the target hosting
plan is verified for it. Azure does not expose
every Node runtime on every Functions hosting plan or region, so the hosting
plan must be selected separately from the language version. The deployment
example below uses Flex Consumption, a Node 24-capable path when that runtime
is offered in the target region. Linux Consumption (Y1) is not a valid
Node 24 target for this package; do not deploy it with the older Node 20/Y1
combination.

```
browser  ->  this proxy  ->  Logic App (SAS URL, server-side secret)  ->  D365 lead
```

## Why Azure Functions (not a Cloudflare Worker)

The Logic Apps, the Azure subscription (`6e60a8fd-9992-4ff7-8a3e-db96b4dfed4f`,
"Microsoft Partner Network"), and our `az` auth all already live in Azure.
Keeping the proxy in the same tenant means the SAS URLs stay as App Settings (or
Key Vault references via MSI) with no extra provider boundary. We still use
**Cloudflare Turnstile** for CAPTCHA (free, privacy-friendly, and the site
already loads `cloudflareinsights`); that is just an outbound HTTPS verify call.

## Endpoints

All POST, `application/json`, anonymous:

| Route                          | Flow                                   |
|--------------------------------|----------------------------------------|
| `/api/lead/contact`            | `Ravonics_Consultation_Intake`         |
| `/api/lead/booking`            | `Ravonics_Consultation_Intake`         |
| `/api/lead/capability_update`  | `Ravonics_CapabilityUpdate_Intake`     |
| `/api/lead` (body `form` field)| routed by the JSON `form` value        |
| `/api/health` (GET)            | health/diagnostics (no secrets)        |

The proxy accepts the **exact JSON payloads the forms already send** and forwards
them verbatim (minus the anti-abuse plumbing fields), with added attribution
fields (`proxy_form`, `proxy_source`, `proxy_received_utc`, `proxy_client_ip`).

### Anti-abuse fields the frontend must add

* `cf_turnstile_token` — the Cloudflare Turnstile token (see frontend cutover).
* `company_website` — **honeypot**. Render a hidden/off-screen input named
  `company_website`; leave it empty. If it arrives non-empty the proxy silently
  drops the submission (returns 200 so bots get no signal).

## What it enforces

1. **Payload cap** — `MAX_BODY_BYTES` (default 20 MB; booking allows ~15 MB of
   base64 attachments). Checked against both `Content-Length` and actual bytes.
2. **Honeypot** — `company_website` non-empty -> dropped.
3. **Spam heuristic** — >=5 URLs or BBCode markup in the free-text fields -> 422.
4. **Rate limit** — per-IP sliding window, `RATE_LIMIT_MAX` (default 5) per
   `RATE_LIMIT_WINDOW_MS` (default 60s). Returns 429 + `Retry-After`.
5. **CAPTCHA** — Cloudflare Turnstile verified server-side. Fails **closed**.
6. **CORS** — only `ALLOWED_ORIGINS` (default `https://ravonics.com,https://www.ravonics.com`).

Errors are graceful and never silently drop a lead: on upstream failure the
proxy returns 502 with a `contact@ravonics.com` message, and the forms keep
their existing `mailto:` fallback.

## App Settings (secrets live ONLY here)

| Setting                     | Value                                                        |
|-----------------------------|-------------------------------------------------------------|
| `LOGICAPP_URL_CONSULTATION` | callback URL of `Ravonics_Consultation_Intake` (SECRET)     |
| `LOGICAPP_URL_CAPABILITY`   | callback URL of `Ravonics_CapabilityUpdate_Intake` (SECRET) |
| `TURNSTILE_SECRET`          | Cloudflare Turnstile secret key (SECRET)                     |
| `TURNSTILE_REQUIRED`        | `true` (set `false` only for a staging bypass)              |
| `MAX_BODY_BYTES`            | `20971520`                                                   |
| `RATE_LIMIT_MAX`            | `5`                                                          |
| `RATE_LIMIT_WINDOW_MS`      | `60000`                                                      |
| `ALLOWED_ORIGINS`           | `https://ravonics.com,https://www.ravonics.com`             |
| `SERVICE_VERSION`            | deployed release identifier (non-secret)                    |
| `SERVICE_COMMIT`             | immutable source commit deployed (non-secret)               |

Never commit a real `local.settings.json`. Use `local.settings.json.example` as
a template for local runs (`func start`). On Flex Consumption, the Node runtime
is set by `functionAppConfig` at app creation/update time; do not add the legacy
`FUNCTIONS_WORKER_RUNTIME` or `WEBSITE_NODE_DEFAULT_VERSION` settings to the
production app.

## Deploy (zip deploy, no Core Tools required)

```bash
SUB=6e60a8fd-9992-4ff7-8a3e-db96b4dfed4f
RG=FocusPass
LOC=eastus
APP=ravonics-lead-proxy            # function app name (must be globally unique)
STG=ravonicsleadproxysa           # storage account (3-24 lc alnum, globally unique)

az account set --subscription "$SUB"

# Storage for the function app.
az storage account create -n "$STG" -g "$RG" -l "$LOC" --sku Standard_LRS

# Flex Consumption function app, Node 24 (production-supported runtime).
# Do not replace --flexconsumption-location with the Linux Consumption (Y1)
# --consumption-plan-location option: Y1 is not a Node 24 target for this app.
az functionapp create -n "$APP" -g "$RG" \
  --storage-account "$STG" \
  --flexconsumption-location "$LOC" \
  --runtime node --runtime-version 24 \
  --functions-version 4

# Secrets + config (replace REDACTED with real values retrieved via listCallbackUrl).
# Bind the running proxy to the source commit being deployed.
GIT_COMMIT="$(git rev-parse HEAD)"
az functionapp config appsettings set -n "$APP" -g "$RG" --settings \
  "LOGICAPP_URL_CONSULTATION=<consultation-callback-url>" \
  "LOGICAPP_URL_CAPABILITY=<capability-callback-url>" \
  "TURNSTILE_SECRET=<turnstile-secret>" \
  "TURNSTILE_REQUIRED=true" \
  "MAX_BODY_BYTES=20971520" \
  "RATE_LIMIT_MAX=5" \
  "RATE_LIMIT_WINDOW_MS=60000" \
  "ALLOWED_ORIGINS=https://ravonics.com,https://www.ravonics.com" \
  "SERVICE_VERSION=2026.08.22" \
  "SERVICE_COMMIT=$GIT_COMMIT"

# Configure Azure's site-level CORS policy as well as the proxy response
# headers. This is required for browser preflight requests on the live forms.
az functionapp cors add -n "$APP" -g "$RG" \
  --allowed-origins https://ravonics.com https://www.ravonics.com

# From proxy/, use Node 24.x to build the deploy zip (production deps only) and push it.
node --version
npm ci --omit=dev
zip -r ../ravonics-lead-proxy.zip . -x 'test/*' '*.test.js' 'local.settings.json' '.git*' 'README.md' >/dev/null
az functionapp deployment source config-zip -n "$APP" -g "$RG" --src ../ravonics-lead-proxy.zip

# Safe live contract: this exercises health, both trusted preflights, rejection
# of untrusted origins, and malformed JSON without creating a lead record.
RAVONICS_EXPECTED_VERSION=2026.08.22 \
RAVONICS_EXPECTED_PROXY_COMMIT="$GIT_COMMIT" \
npm run proxy:smoke
```

If Flex Consumption or Node 24 is unavailable in the target subscription or
region, choose another Azure Functions plan that explicitly exposes Node 24.
Do not deploy this proxy on Node 26 until Azure Functions officially supports
that runtime. Do not fall back to Linux Consumption/Y1 with Node 20 without
separately revalidating the package runtime requirement and deployment plan.

Retrieve the Logic App callback URLs (these are the secrets) with:

```bash
az rest --method post --url \
 "https://management.azure.com/subscriptions/$SUB/resourceGroups/$RG/providers/Microsoft.Logic/workflows/Ravonics_Consultation_Intake/triggers/manual/listCallbackUrl?api-version=2016-06-01" \
 --query value -o tsv
# ...and Ravonics_CapabilityUpdate_Intake the same way.
```

The proxy base URL is then `https://<APP>.azurewebsites.net/api`.

### Optional hardening: Key Vault references

Instead of plaintext App Settings, store the two URLs + Turnstile secret in a
Key Vault and reference them:

```bash
az functionapp identity assign -n "$APP" -g "$RG"          # enable MSI
# grant the MSI 'get' on secrets in the vault, then:
az functionapp config appsettings set -n "$APP" -g "$RG" --settings \
  "LOGICAPP_URL_CONSULTATION=@Microsoft.KeyVault(SecretUri=https://<vault>.vault.azure.net/secrets/consultation-url/)"
```

## Tests

```bash
npm test              # pure-logic and bounded handler tests, no network
node --test           # direct equivalent
```

Live integration test (after deploy): see the "TEST" section of the task report.
Use a `ZZZ TEST` company prefix and delete the resulting D365 lead afterward.

## Frontend cutover

`scripts/inject-endpoints.sh` (repo root) writes `js/form-endpoints.js`. With
`RAVONICS_USE_PROXY=1` and `RAVONICS_PROXY_BASE=https://<APP>.azurewebsites.net/api`
it points the forms at the proxy paths instead of the raw SAS URLs. The forms
must also render a Turnstile widget and send `cf_turnstile_token` + the
`company_website` honeypot; that markup touches page structure and is handled via
the publish overlay / IRON-RULE process by the orchestrator (see the task report).
