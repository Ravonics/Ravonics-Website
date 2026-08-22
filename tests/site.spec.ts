import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { collectLiveRoutes } from '../scripts/site-routes.mjs';

const routes = collectLiveRoutes();

test.describe('published route contract', () => {
  for (const route of routes) {
    test(route.route, async ({ page }) => {
      // Accessibility assertions should inspect the settled document, not a
      // partially transparent animation frame from the legacy theme.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const response = await page.goto(route.route, { waitUntil: 'domcontentloaded' });
      expect(response?.status(), `${route.route} response`).toBe(200);
      await expect(page).toHaveTitle(/\S+/);
      await expect(page.locator('main')).toHaveCount(1);
      await expect(page.locator('h1')).toHaveCount(1);

      const brokenImages = await page
        .locator('img')
        .evaluateAll((images) =>
          (images as HTMLImageElement[])
            .filter((image) => image.complete && image.naturalWidth === 0)
            .map((image) => image.getAttribute('src') || image.getAttribute('data-src') || 'unknown')
        );
      expect(brokenImages, `${route.route} broken images`).toEqual([]);

      const hasHorizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1
      );
      expect(hasHorizontalOverflow, `${route.route} horizontal overflow`).toBe(false);

      const axeResults = await new AxeBuilder({ page }).analyze();
      const blockingViolations = axeResults.violations.filter(
        (violation) => violation.impact === 'critical' || violation.impact === 'serious'
      );
      expect(blockingViolations, `${route.route} critical/serious accessibility violations`).toEqual([]);
    });
  }

  test('feeds and sitemap are published', async ({ request }) => {
    for (const resource of ['/rss.xml', '/sitemap.xml']) {
      const response = await request.get(resource);
      expect(response.status(), resource).toBe(200);
    }
  });

  test('information panel is keyboard accessible', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const trigger = page.locator('#btn-extra');
    const dialog = page.locator('#extra-wrap');
    await trigger.click();
    await expect(dialog).toHaveAttribute('role', 'dialog');
    await expect(dialog).toHaveAttribute('aria-hidden', 'false');
    await expect(page.locator('#btn-close')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveAttribute('aria-hidden', 'true');
    await expect(trigger).toBeFocused();
  });

  test('conversion forms expose a no-JavaScript contact path', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    for (const route of ['/contact.html', '/booking.html', '/company/doing-business.html']) {
      const page = await context.newPage();
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('.no-js-fallback')).toBeVisible();
      await expect(page.locator('.no-js-fallback a[href^="mailto:"]')).toHaveCount(1);
      await page.close();
    }
    await context.close();
  });
});
