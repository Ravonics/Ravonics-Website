import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { collectLiveRoutes } from '../scripts/site-routes.mjs';

const routes = collectLiveRoutes();

test.describe('published route contract', () => {
  for (const route of routes) {
    test(route.route, async ({ page }) => {
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
      const criticalViolations = axeResults.violations.filter((violation) => violation.impact === 'critical');
      expect(criticalViolations, `${route.route} critical accessibility violations`).toEqual([]);
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
});
