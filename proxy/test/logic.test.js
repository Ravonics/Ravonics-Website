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

// Import the exported pure helpers. Loading index.js registers Azure routes via
// app.http(); that is a no-op outside the Functions host, so it is safe here.
const { looksLikeSpam, checkRateLimit } = require('../src/index.js');

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
