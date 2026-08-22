import { expect, test, type Page, type Route } from '@playwright/test';

type SubmittedPayload = Record<string, unknown>;

async function blockTurnstile(page: Page) {
  await page.route('https://challenges.cloudflare.com/**', (route) => route.abort());
}

async function completeTurnstile(page: Page) {
  await page.evaluate(() => {
    const callback = (window as unknown as { onTurnstileComplete?: (token: string) => void })
      .onTurnstileComplete;
    if (typeof callback !== 'function') {
      throw new Error('Turnstile callback was not registered');
    }
    callback('playwright-turnstile-token');
  });
}

async function fulfillJson(route: Route, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(
      status >= 200 && status < 300 ? { ok: true, accepted: true } : { ok: false, error: 'synthetic_failure' }
    )
  });
}

function captureLead(form: string, status = 200) {
  const submitted: SubmittedPayload[] = [];
  const pattern = `**/api/lead/${form}`;
  const handler = async (route: Route) => {
    const postData = route.request().postData();
    submitted.push(postData ? (JSON.parse(postData) as SubmittedPayload) : {});
    await fulfillJson(route, status);
  };
  return { submitted, pattern, handler };
}

test.describe('customer lead journeys', () => {
  test('contact journey validates, posts through the proxy, and confirms success', async ({ page }) => {
    const capture = captureLead('contact');
    await page.route(capture.pattern, capture.handler);
    await blockTurnstile(page);
    await page.goto('/contact.html');

    await page.fill('#name', 'Ada Lovelace');
    await page.fill('#email', 'ada@example.gov');
    await page.fill('#phone', '+1 304 555 0100');
    await page.fill('#message', 'We would like to discuss an unclassified AI/ML program requirement.');
    await completeTurnstile(page);
    await page.locator('#send_message').click();

    await expect(page.locator('#contact_success_message')).toBeVisible();
    expect(capture.submitted).toHaveLength(1);
    expect(capture.submitted[0]).toMatchObject({
      firstname: 'Ada',
      lastname: 'Lovelace',
      emailaddress1: 'ada@example.gov',
      cf_turnstile_token: 'playwright-turnstile-token',
      company_website: ''
    });
  });

  test('booking journey includes organization, interests, authorization, and anti-abuse fields', async ({
    page
  }) => {
    const capture = captureLead('booking');
    await page.route(capture.pattern, capture.handler);
    await blockTurnstile(page);
    await page.goto('/booking.html');

    await page.fill('#org_name', 'Ravonics Test Agency');
    await page.selectOption('#agency_type', 'Federal Civilian Agency');
    await page.fill('#contact_name', 'Grace Hopper');
    await page.fill('#contact_email', 'grace@example.gov');
    await page.check('#int_ai');
    await page.fill('#notes', 'Unclassified capability discussion for a synthetic RFI.');
    await page.check('#agree_contact');
    await completeTurnstile(page);
    await page.locator('#rfp_submit_btn').click();

    await expect(page.locator('#success_message')).toBeVisible();
    expect(capture.submitted).toHaveLength(1);
    expect(capture.submitted[0]).toMatchObject({
      org_name: 'Ravonics Test Agency',
      contact_first_name: 'Grace',
      contact_last_name: 'Hopper',
      contact_email: 'grace@example.gov',
      interests: 'AI & Machine Learning',
      agree_terms: 'Yes',
      cf_turnstile_token: 'playwright-turnstile-token',
      company_website: ''
    });
  });

  test('capability-update journey posts to its dedicated route and confirms success', async ({ page }) => {
    const capture = captureLead('capability_update');
    await page.route(capture.pattern, capture.handler);
    await blockTurnstile(page);
    await page.goto('/company/doing-business.html');

    await page.fill('#cu_name', 'Katherine Johnson');
    await page.fill('#cu_org', 'Ravonics Test Lab');
    await page.fill('#cu_email', 'katherine@example.gov');
    await page.fill('#cu_interest', 'Secure autonomy and decision support');
    await completeTurnstile(page);
    await page.locator('#cu_send').click();

    await expect(page.locator('#cu_success_message')).toBeVisible();
    expect(capture.submitted).toHaveLength(1);
    expect(capture.submitted[0]).toMatchObject({
      firstname: 'Katherine Johnson',
      emailaddress1: 'katherine@example.gov',
      leadsourcecode: 'capability-updates',
      cf_turnstile_token: 'playwright-turnstile-token',
      company_website: ''
    });
  });

  test('contact journey exposes a recoverable error when the proxy rejects a submission', async ({
    page
  }) => {
    const capture = captureLead('contact', 502);
    await page.route(capture.pattern, capture.handler);
    await blockTurnstile(page);
    await page.goto('/contact.html');

    await page.fill('#name', 'Test Contact');
    await page.fill('#email', 'test@example.gov');
    await page.fill('#phone', '+1 304 555 0101');
    await page.fill('#message', 'Synthetic error-recovery journey.');
    await completeTurnstile(page);
    await page.locator('#send_message').click();

    await expect(page.locator('#contact_error_message')).toBeVisible();
    await expect(page.locator('#send_message')).toBeEnabled();
    expect(capture.submitted).toHaveLength(1);
  });

  test('contact journey shows validation before posting when CAPTCHA is incomplete', async ({ page }) => {
    let requestCount = 0;
    await page.route('**/api/lead/contact', async (route) => {
      requestCount += 1;
      await route.abort();
    });
    await blockTurnstile(page);
    await page.goto('/contact.html');

    await page.fill('#name', 'Validation Test');
    await page.fill('#email', 'validation@example.gov');
    await page.fill('#phone', '+1 304 555 0102');
    await page.fill('#message', 'This should not be sent without a security token.');
    await page.locator('#send_message').click();

    await expect(page.locator('#contact_validation_message')).toBeVisible();
    expect(requestCount).toBe(0);
  });
});
