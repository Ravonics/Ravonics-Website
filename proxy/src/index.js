'use strict';

/**
 * Ravonics lead-capture proxy (Azure Functions v4, Node 24+).
 *
 * Purpose
 * -------
 * The public Ravonics forms (contact / booking / capability-update) previously
 * POSTed directly to Azure Logic App callback URLs. Those URLs carry a `sig=`
 * SAS token, so shipping them in client-side JS inherently exposes a public,
 * unauthenticated write endpoint into Dynamics 365 (lead spam / abuse).
 *
 * This Function sits in front of those Logic Apps:
 *   browser  ->  this proxy  ->  Logic App (SAS URL, server-side secret)  ->  D365
 *
 * It accepts the SAME JSON payloads the forms already send (so the frontend
 * contract barely changes), then:
 *   1. enforces a payload size cap,
 *   2. runs a honeypot + lightweight content/spam heuristic,
 *   3. verifies a Cloudflare Turnstile token server-side,
 *   4. applies a per-IP sliding-window rate limit,
 *   5. forwards the validated payload (Turnstile/honeypot fields stripped, plus
 *      lead-source attribution) to the correct Logic App callback URL,
 *   6. returns clean success/error JSON the existing form JS can handle.
 *
 * The Logic App SAS URLs live ONLY in App Settings (LOGICAPP_URL_*), never in
 * client code or git. Turnstile keys live in App Settings too.
 *
 * Routes (all POST):
 *   /api/lead/contact            -> consultation intake flow
 *   /api/lead/booking            -> consultation intake flow
 *   /api/lead/capability_update  -> capability-update (nurture) flow
 *   /api/lead                    -> route by JSON body `form` field
 */

const { app } = require('@azure/functions');
const { randomUUID } = require('node:crypto');

const packageVersion = require('../package.json').version;
const SERVICE_VERSION = process.env.SERVICE_VERSION || packageVersion || 'dev';
const SERVICE_COMMIT = process.env.SERVICE_COMMIT || 'unknown';

// ---------------------------------------------------------------------------
// Configuration (all from App Settings / environment)
// ---------------------------------------------------------------------------

const CONFIG = {
  // Logic App callback URLs (secrets). One per logical flow.
  // contact + booking share the consultation flow; capability_update is its own.
  urls: {
    contact: process.env.LOGICAPP_URL_CONSULTATION || '',
    booking: process.env.LOGICAPP_URL_CONSULTATION || '',
    capability_update: process.env.LOGICAPP_URL_CAPABILITY || ''
  },

  // Cloudflare Turnstile.
  turnstileSecret: process.env.TURNSTILE_SECRET || '',
  // When true, requests missing/failing Turnstile are rejected. When the secret
  // is unset we fail-closed in production-like config; see verifyTurnstile().
  turnstileRequired: String(process.env.TURNSTILE_REQUIRED || 'true').toLowerCase() !== 'false',

  // Abuse controls.
  maxBodyBytes: parseInt(process.env.MAX_BODY_BYTES || String(20 * 1024 * 1024), 10), // 20 MB (booking allows ~15 MB of base64 attachments)
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '5', 10), // requests
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10), // per window (default 60s)

  // CORS: comma-separated allowed origins. Default to the production site.
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'https://ravonics.com,https://www.ravonics.com')
    .split(',')
    .map(function (s) {
      return s.trim();
    })
    .filter(Boolean)
};

// The honeypot field name. The frontend renders a hidden, off-screen input with
// this name; real users never fill it, bots that fill every field do.
const HONEYPOT_FIELD = 'company_website';

// Fields that are proxy/anti-abuse plumbing and must NOT be forwarded to D365.
const STRIP_FIELDS = ['cf_turnstile_token', 'turnstile_token', HONEYPOT_FIELD];

// Valid logical form names.
const VALID_FORMS = ['contact', 'booking', 'capability_update'];

// ---------------------------------------------------------------------------
// In-memory per-IP sliding-window rate limiter.
//
// Adequate for a single-instance Consumption plan handling a low-traffic
// marketing site. It is intentionally best-effort: if the platform scales out
// or recycles the worker, the worst case is a slightly more permissive limit,
// never a dropped lead. (A durable limiter would use Table Storage / Redis; not
// warranted for this volume.)
// ---------------------------------------------------------------------------

const rateState = new Map(); // ip -> number[] (timestamps, ms)

function checkRateLimit(ip, now) {
  const windowStart = now - CONFIG.rateLimitWindowMs;
  let hits = rateState.get(ip);
  if (!hits) {
    hits = [];
    rateState.set(ip, hits);
  }
  // Drop timestamps outside the window.
  while (hits.length && hits[0] < windowStart) {
    hits.shift();
  }
  if (hits.length >= CONFIG.rateLimitMax) {
    const retryAfterMs = hits[0] + CONFIG.rateLimitWindowMs - now;
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }
  hits.push(now);
  return { allowed: true };
}

// Opportunistically prune stale IP entries so the map cannot grow unbounded.
function pruneRateState(now) {
  if (rateState.size < 5000) {
    return;
  }
  const cutoff = now - CONFIG.rateLimitWindowMs;
  for (const [ip, hits] of rateState) {
    if (!hits.length || hits[hits.length - 1] < cutoff) {
      rateState.delete(ip);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clientIp(request) {
  // Azure Functions sits behind the platform proxy; the real client IP arrives
  // in X-Forwarded-For (may be a comma-separated list, client first).
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0].trim();
    // X-Forwarded-For on Azure can include :port; strip it.
    return first.replace(/:\d+$/, '');
  }
  return request.headers.get('x-client-ip') || 'unknown';
}

function corsHeaders(origin, correlationId) {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin'
  };
  if (origin && CONFIG.allowedOrigins.indexOf(origin) !== -1) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Access-Control-Max-Age'] = '86400';
  }
  if (correlationId) {
    headers['X-Correlation-ID'] = correlationId;
  }
  return headers;
}

function correlationIdFor(request) {
  const supplied = request.headers.get('x-correlation-id') || '';
  if (/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(supplied)) {
    return supplied;
  }
  return randomUUID();
}

function logEvent(context, event, fields) {
  if (!context || typeof context.log !== 'function') {
    return;
  }
  context.log(
    JSON.stringify({
      event: 'ravonics.' + event,
      ...fields
    })
  );
}

function jsonResponse(status, bodyObj, origin, correlationId) {
  return {
    status: status,
    headers: corsHeaders(origin, correlationId),
    jsonBody: bodyObj
  };
}

/**
 * Verify a Cloudflare Turnstile token server-side.
 * Returns { ok: true } on success, or { ok: false, reason } on failure.
 */
async function verifyTurnstile(token, ip, context) {
  if (!CONFIG.turnstileSecret) {
    // No secret configured. Fail closed if Turnstile is required, otherwise
    // allow (explicit opt-out via TURNSTILE_REQUIRED=false for staging only).
    if (CONFIG.turnstileRequired) {
      context.error('Turnstile secret not configured but TURNSTILE_REQUIRED is true; rejecting.');
      return { ok: false, reason: 'captcha_misconfigured' };
    }
    context.warn('Turnstile disabled (no secret, TURNSTILE_REQUIRED=false). Skipping verification.');
    return { ok: true, skipped: true };
  }

  if (!token) {
    return { ok: false, reason: 'captcha_missing' };
  }

  const body = new URLSearchParams();
  body.append('secret', CONFIG.turnstileSecret);
  body.append('response', token);
  if (ip && ip !== 'unknown') {
    body.append('remoteip', ip);
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(function () {
      controller.abort();
    }, 8000);
    let resp;
    try {
      resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      context.error('Turnstile siteverify HTTP error: ' + resp.status);
      return { ok: false, reason: 'captcha_verify_unreachable' };
    }

    const data = await resp.json();
    if (data && data.success === true) {
      return { ok: true };
    }
    context.warn('Turnstile verification failed: ' + JSON.stringify(data['error-codes'] || data));
    return { ok: false, reason: 'captcha_failed' };
  } catch (err) {
    context.error('Turnstile verification threw: ' + (err && err.message ? err.message : String(err)));
    // Network problem reaching Cloudflare. Fail closed so we never bypass CAPTCHA
    // silently, but report a distinct reason so the frontend can advise a retry.
    return { ok: false, reason: 'captcha_verify_unreachable' };
  }
}

/**
 * Lightweight spam heuristic over the free-text fields. Conservative on
 * purpose: this is a federal-contractor B2B form with low legitimate volume, so
 * we only reject blatant link-spam, not borderline content.
 */
function looksLikeSpam(payload) {
  const textFields = ['description', 'notes', 'message', 'org_name', 'subject', 'capability_summary'];
  let blob = '';
  for (const f of textFields) {
    if (typeof payload[f] === 'string') {
      blob += ' ' + payload[f];
    }
  }
  blob = blob.toLowerCase();

  if (!blob.trim()) {
    return null; // nothing to judge here; required-field validation lives upstream
  }

  // Excessive URLs are the strongest signal of bot link-spam.
  const urlMatches = blob.match(/https?:\/\//g) || [];
  if (urlMatches.length >= 5) {
    return 'too_many_links';
  }

  // BBCode markup is essentially never legitimate in this context.
  if (/\[url=|\[\/url\]|\[link=/.test(blob)) {
    return 'forum_spam_markup';
  }

  return null;
}

/**
 * Forward the cleaned payload to a Logic App callback URL and normalise the
 * result. Never throws; returns a structured outcome so the caller can map it
 * to a clean client response and we never silently drop a lead.
 */
async function forwardToLogicApp(url, payload, context) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(function () {
      controller.abort();
    }, 25000);
    let resp;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }

    if (resp.status >= 200 && resp.status < 300) {
      return { ok: true, status: resp.status };
    }

    context.error('Logic App returned HTTP ' + resp.status + '.');
    return { ok: false, status: resp.status, upstream: true };
  } catch (err) {
    context.error('Logic App forward failed: ' + (err && err.message ? err.message : String(err)));
    return { ok: false, status: 0, upstream: true };
  }
}

// ---------------------------------------------------------------------------
// Core handler
// ---------------------------------------------------------------------------

async function handleLead(formFromRoute, request, context) {
  const origin = request.headers.get('origin') || '';
  const correlationId = correlationIdFor(request);
  const respond = function (status, bodyObj) {
    return jsonResponse(status, bodyObj, origin, correlationId);
  };

  // Preflight.
  if (request.method === 'OPTIONS') {
    logEvent(context, 'lead.preflight', { correlation_id: correlationId });
    return { status: 204, headers: corsHeaders(origin, correlationId) };
  }

  // CORS prevents untrusted browsers from reading responses, but it does not
  // stop a cross-site POST from reaching the function. Reject browser-origin
  // requests outside the allowlist before parsing or forwarding any payload;
  // requests without Origin remain available for trusted server-side callers.
  if (origin && CONFIG.allowedOrigins.indexOf(origin) === -1) {
    context.warn('Rejected request from untrusted origin: ' + origin);
    return respond(
      403,
      { ok: false, error: 'origin_not_allowed', message: 'Origin is not allowed.' }
    );
  }

  const now = Date.now();
  const ip = clientIp(request);
  pruneRateState(now);

  // --- Payload size cap (defense before we even parse) ---------------------
  const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
  if (contentLength && contentLength > CONFIG.maxBodyBytes) {
    context.warn('Rejected oversized payload from ' + ip + ': ' + contentLength + ' bytes');
    return respond(
      413,
      {
        ok: false,
        error: 'payload_too_large',
        message: 'The submission is too large. Please reduce attachment size and try again.'
      }
    );
  }

  // --- Parse body ----------------------------------------------------------
  let raw;
  try {
    raw = await request.text();
  } catch (err) {
    context.error('Failed to read request body: ' + err.message);
    return respond(
      400,
      { ok: false, error: 'bad_request', message: 'Could not read the submission.' }
    );
  }

  // Enforce the cap again against the actual bytes (Content-Length can lie).
  if (Buffer.byteLength(raw, 'utf8') > CONFIG.maxBodyBytes) {
    context.warn('Rejected oversized payload (actual) from ' + ip);
    return respond(
      413,
      {
        ok: false,
        error: 'payload_too_large',
        message: 'The submission is too large. Please reduce attachment size and try again.'
      }
    );
  }

  let payload;
  try {
    payload = JSON.parse(raw || '{}');
  } catch (err) {
    return respond(
      400,
      { ok: false, error: 'invalid_json', message: 'The submission was malformed.' }
    );
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return respond(
      400,
      { ok: false, error: 'invalid_payload', message: 'The submission was malformed.' }
    );
  }

  // --- Resolve the target form --------------------------------------------
  let form = formFromRoute || payload.form || '';
  form = String(form).toLowerCase();
  if (VALID_FORMS.indexOf(form) === -1) {
    return respond(400, { ok: false, error: 'unknown_form', message: 'Unknown form target.' });
  }

  logEvent(context, 'lead.received', {
    correlation_id: correlationId,
    form,
    method: request.method
  });

  const targetUrl = CONFIG.urls[form];
  if (!targetUrl) {
    context.error('No Logic App URL configured for form "' + form + '". Check App Settings.');
    return respond(
      500,
      {
        ok: false,
        error: 'not_configured',
        message: 'The submission service is temporarily unavailable. Please email us directly.'
      }
    );
  }

  // --- Honeypot ------------------------------------------------------------
  if (payload[HONEYPOT_FIELD]) {
    // Silently accept (200) so bots get no signal, but do not forward.
    context.warn('Honeypot tripped from ' + ip + ' on form ' + form + '; dropping.');
    logEvent(context, 'lead.completed', { correlation_id: correlationId, form, outcome: 'honeypot' });
    return respond(200, { ok: true, accepted: true });
  }

  // --- Spam heuristic ------------------------------------------------------
  const spamReason = looksLikeSpam(payload);
  if (spamReason) {
    context.warn('Spam heuristic (' + spamReason + ') from ' + ip + ' on form ' + form + '; dropping.');
    // Return a generic validation error rather than revealing the heuristic.
    return respond(
      422,
      {
        ok: false,
        error: 'rejected',
        message:
          'Your message could not be accepted. Please remove links and try again, or email us directly.'
      }
    );
  }

  // --- Rate limit ----------------------------------------------------------
  const rl = checkRateLimit(ip, now);
  if (!rl.allowed) {
    context.warn('Rate limit hit for ' + ip + ' on form ' + form);
    logEvent(context, 'lead.completed', { correlation_id: correlationId, form, outcome: 'rate_limited' });
    return {
      status: 429,
      headers: Object.assign(corsHeaders(origin, correlationId), { 'Retry-After': String(rl.retryAfterSec) }),
      jsonBody: {
        ok: false,
        error: 'rate_limited',
        message: 'Too many submissions. Please wait a moment and try again.',
        retry_after: rl.retryAfterSec
      }
    };
  }

  // --- CAPTCHA -------------------------------------------------------------
  const token = payload.cf_turnstile_token || payload.turnstile_token || '';
  const captcha = await verifyTurnstile(token, ip, context);
  if (!captcha.ok) {
    const status =
      captcha.reason === 'captcha_verify_unreachable' || captcha.reason === 'captcha_misconfigured'
        ? 503
        : 403;
    return respond(
      status,
      {
        ok: false,
        error: captcha.reason,
        message:
          status === 503
            ? 'We could not verify the security check right now. Please try again shortly, or email us directly.'
            : 'Security check failed. Please complete the challenge and try again.'
      }
    );
  }

  // --- Build the forwarded payload ----------------------------------------
  // Strip plumbing fields; add server-side lead-source attribution.
  const forwarded = {};
  for (const k of Object.keys(payload)) {
    if (STRIP_FIELDS.indexOf(k) === -1 && k !== 'form') {
      forwarded[k] = payload[k];
    }
  }
  // Attribution: record that this lead came through the proxy and which form.
  forwarded.proxy_form = form;
  forwarded.proxy_source = 'lead-proxy';
  forwarded.proxy_received_utc = new Date(now).toISOString();
  forwarded.proxy_client_ip = ip;

  // --- Forward -------------------------------------------------------------
  const result = await forwardToLogicApp(targetUrl, forwarded, context);
  if (result.ok) {
    logEvent(context, 'lead.completed', { correlation_id: correlationId, form, outcome: 'accepted' });
    return respond(200, { ok: true, accepted: true });
  }

  // Upstream failure. Surface a clean error; the frontend keeps its mailto
  // fallback so the lead is never silently lost.
  logEvent(context, 'lead.completed', { correlation_id: correlationId, form, outcome: 'upstream_failed' });
  return respond(
    502,
    {
      ok: false,
      error: 'upstream_failed',
      message: 'We could not submit your request right now. Please email us directly at contact@ravonics.com.'
    }
  );
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

app.http('lead-by-path', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'lead/{form}',
  handler: function (request, context) {
    return handleLead(request.params.form, request, context);
  }
});

app.http('lead-by-body', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'lead',
  handler: function (request, context) {
    return handleLead(null, request, context);
  }
});

// Lightweight health check (no secrets revealed).
app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: async function (request, context) {
    const correlationId = correlationIdFor(request);
    logEvent(context, 'health', { correlation_id: correlationId });
    return {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Correlation-ID': correlationId
      },
      jsonBody: {
        ok: true,
        service: 'ravonics-lead-proxy',
        version: SERVICE_VERSION,
        source_commit: SERVICE_COMMIT,
        runtime: process.versions.node,
        forms_configured: VALID_FORMS.filter(function (f) {
          return !!CONFIG.urls[f];
        }),
        turnstile: CONFIG.turnstileSecret ? 'configured' : 'absent',
        turnstile_required: CONFIG.turnstileRequired
      }
    };
  }
});

module.exports = { handleLead, looksLikeSpam, checkRateLimit, verifyTurnstile, correlationIdFor };
