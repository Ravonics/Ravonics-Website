'use strict';

/**
 * Unit tests for the proxy's pure logic (no network, no Azure runtime).
 * Run: node --test  (from the proxy/ directory)
 *
 * These cover the spam heuristic and the sliding-window rate limiter. The HTTP
 * handler, Turnstile verification, and Logic App forwarding are exercised by the
 * live integration test described in README.md (they require network + secrets).
 */

const { test } = require('node:test');
const assert = require('node:assert');

// Load the proxy with a deliberately empty, non-network test configuration.
// This keeps handler tests independent of any developer or CI secrets.
const CONFIG_ENV_KEYS = [
  'LOGICAPP_URL_CONSULTATION',
  'LOGICAPP_URL_CAPABILITY',
  'TURNSTILE_SECRET',
  'TURNSTILE_REQUIRED',
  'MAX_BODY_BYTES',
  'RATE_LIMIT_MAX',
  'RATE_LIMIT_WINDOW_MS',
  'ALLOWED_ORIGINS',
  'SERVICE_VERSION'
];
const originalEnvironment = new Map();
for (const key of CONFIG_ENV_KEYS) {
  originalEnvironment.set(key, process.env[key]);
  delete process.env[key];
}

let proxy;
try {
  // Loading index.js registers Azure routes via app.http(); that is a no-op
  // outside the Functions host, so it is safe here.
  proxy = require('../src/index.js');
} finally {
  for (const key of CONFIG_ENV_KEYS) {
    const value = originalEnvironment.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

const { handleLead, looksLikeSpam, checkRateLimit, verifyTurnstile } = proxy;

function testContext() {
  return { warn() {}, error() {} };
}

test('looksLikeSpam: clean B2B message passes', function () {
  const payload = {
    description: 'We have an upcoming RFP for AI/ML decision support and want to discuss capabilities.'
  };
  assert.strictEqual(looksLikeSpam(payload), null);
});

test('looksLikeSpam: one link is fine', function () {
  const payload = { notes: 'See our solicitation at https://sam.gov/opp/12345 for details.' };
  assert.strictEqual(looksLikeSpam(payload), null);
});

test('looksLikeSpam: five or more links is rejected', function () {
  const payload = {
    message: 'http://a.com http://b.com http://c.com http://d.com http://e.com'
  };
  assert.strictEqual(looksLikeSpam(payload), 'too_many_links');
});

test('looksLikeSpam: BBCode markup is rejected', function () {
  const payload = { description: 'Great deals [url=http://spam.example]click here[/url]' };
  assert.strictEqual(looksLikeSpam(payload), 'forum_spam_markup');
});

test('looksLikeSpam: empty text is neutral', function () {
  assert.strictEqual(looksLikeSpam({}), null);
});

test('checkRateLimit: allows up to the limit then blocks', function () {
  // Use a unique IP so test ordering cannot interfere with shared state.
  const ip = 'test-ip-' + Math.random();
  const now = Date.now();
  // Default RATE_LIMIT_MAX is 5.
  for (let i = 0; i < 5; i++) {
    const r = checkRateLimit(ip, now);
    assert.strictEqual(r.allowed, true, 'request ' + (i + 1) + ' should be allowed');
  }
  const blocked = checkRateLimit(ip, now);
  assert.strictEqual(blocked.allowed, false, 'sixth request should be blocked');
  assert.ok(blocked.retryAfterSec >= 1, 'retryAfterSec should be set');
});

test('checkRateLimit: window slides so old hits expire', function () {
  const ip = 'test-ip-slide-' + Math.random();
  const t0 = 1000000;
  for (let i = 0; i < 5; i++) {
    assert.strictEqual(checkRateLimit(ip, t0).allowed, true);
  }
  assert.strictEqual(checkRateLimit(ip, t0).allowed, false);
  // Far in the future, the window has fully slid past the old hits.
  const later = t0 + 61000; // > default 60s window
  assert.strictEqual(checkRateLimit(ip, later).allowed, true);
});

test('handleLead: allows CORS preflight without network access', async function () {
  const request = new Request('https://example.test/api/lead/contact', {
    method: 'OPTIONS',
    headers: { origin: 'https://ravonics.com' }
  });
  const result = await handleLead('contact', request, testContext());

  assert.strictEqual(result.status, 204);
  assert.strictEqual(result.headers['Access-Control-Allow-Origin'], 'https://ravonics.com');
  assert.strictEqual(result.headers['Access-Control-Allow-Methods'], 'POST, OPTIONS');
  assert.strictEqual(result.headers['Cache-Control'], 'no-store');
  assert.strictEqual(result.headers['X-Content-Type-Options'], 'nosniff');
});

test('handleLead: rejects malformed JSON before configuration or network access', async function () {
  const request = new Request('https://example.test/api/lead/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{'
  });
  const result = await handleLead('contact', request, testContext());

  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.jsonBody.error, 'invalid_json');
});

test('handleLead: rejects unknown body form without network access', async function () {
  const request = new Request('https://example.test/api/lead', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ form: 'not-a-form' })
  });
  const result = await handleLead(null, request, testContext());

  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.jsonBody.error, 'unknown_form');
});

test('handleLead: reports missing upstream configuration without forwarding', async function () {
  const request = new Request('https://example.test/api/lead/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ description: 'A normal B2B inquiry.' })
  });
  const result = await handleLead('contact', request, testContext());

  assert.strictEqual(result.status, 500);
  assert.strictEqual(result.jsonBody.error, 'not_configured');
});

test('verifyTurnstile: missing secret fails closed without network access', async function () {
  const messages = [];
  const result = await verifyTurnstile('test-token', 'unknown', {
    warn(message) { messages.push(message); },
    error(message) { messages.push(message); }
  });

  assert.deepStrictEqual(result, { ok: false, reason: 'captcha_misconfigured' });
  assert.strictEqual(messages.length, 1);
});
