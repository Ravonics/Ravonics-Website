const base = (process.env.RAVONICS_PROXY_BASE || 'https://ravonics-lead-proxy.azurewebsites.net/api').replace(
  /\/$/,
  ''
);
const expectedVersion = process.env.RAVONICS_EXPECTED_VERSION || '';

function fail(message) {
  throw new Error(message);
}

async function expectJson(response, label) {
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    fail(`${label}: expected JSON response`);
  }
  return body;
}

const health = await fetch(`${base}/health`);
if (health.status !== 200) fail(`health: expected 200, received ${health.status}`);
if (health.headers.get('cache-control') !== 'no-store') fail('health: missing Cache-Control: no-store');
if (health.headers.get('x-content-type-options') !== 'nosniff')
  fail('health: missing X-Content-Type-Options: nosniff');
const healthBody = await expectJson(health, 'health');
if (healthBody.ok !== true || healthBody.service !== 'ravonics-lead-proxy') {
  fail('health: unexpected service response');
}
if (!Array.isArray(healthBody.forms_configured) || healthBody.forms_configured.length !== 3) {
  fail('health: expected all three forms to be configured');
}
if (healthBody.turnstile !== 'configured' || healthBody.turnstile_required !== true) {
  fail('health: Turnstile is not configured as required');
}
if (expectedVersion && healthBody.version !== expectedVersion) {
  fail(`health: expected version ${expectedVersion}, received ${healthBody.version}`);
}

const preflight = await fetch(`${base}/lead/contact`, {
  method: 'OPTIONS',
  headers: { Origin: 'https://ravonics.com' }
});
if (preflight.status !== 204) fail(`preflight: expected 204, received ${preflight.status}`);
if (preflight.headers.get('access-control-allow-origin') !== 'https://ravonics.com') {
  fail('preflight: production origin was not allowlisted');
}

const malformed = await fetch(`${base}/lead/contact`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'https://ravonics.com' },
  body: '{'
});
if (malformed.status !== 400) fail(`malformed JSON: expected 400, received ${malformed.status}`);
const malformedBody = await expectJson(malformed, 'malformed JSON');
if (malformedBody.error !== 'invalid_json') fail('malformed JSON: unexpected error contract');

console.log(
  JSON.stringify(
    {
      ok: true,
      base,
      version: healthBody.version,
      runtime: healthBody.runtime,
      forms: healthBody.forms_configured,
      checks: ['health', 'cors-preflight', 'malformed-json']
    },
    null,
    2
  )
);
