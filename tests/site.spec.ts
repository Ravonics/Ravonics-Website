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
        (violation) =>
          violation.impact === 'critical' || violation.impact === 'serious' || violation.impact === 'moderate'
      );
      expect(blockingViolations, `${route.route} critical/serious/moderate accessibility violations`).toEqual(
        []
      );
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

  test('home header stays compact and home media keeps its intrinsic proportions', async ({ page }) => {
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 993, height: 900 },
      { width: 1440, height: 900 }
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/', { waitUntil: 'load' });

      const geometry = await page.locator('header').evaluate((header) => {
        const visibleLogo = [...document.querySelectorAll<HTMLImageElement>('#logo img')].find((image) => {
          const style = window.getComputedStyle(image);
          const rect = image.getBoundingClientRect();
          return (
            style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
          );
        });
        const rect = header.getBoundingClientRect();
        const imageGeometry = (image: HTMLImageElement) => {
          const imageRect = image.getBoundingClientRect();
          return {
            width: imageRect.width,
            height: imageRect.height,
            naturalWidth: image.naturalWidth,
            naturalHeight: image.naturalHeight
          };
        };

        return {
          headerHeight: rect.height,
          logo: visibleLogo ? imageGeometry(visibleLogo) : null,
          homeIcons: [...document.querySelectorAll<HTMLImageElement>('main img[src*="icons-maroon/home"]')]
            .filter((image) => {
              const imageRect = image.getBoundingClientRect();
              const style = window.getComputedStyle(image);
              return style.display !== 'none' && imageRect.width > 0 && imageRect.height > 0;
            })
            .map(imageGeometry)
        };
      });

      expect(geometry.headerHeight, `header height at ${viewport.width}px`).toBeGreaterThan(0);
      expect(geometry.headerHeight, `header height at ${viewport.width}px`).toBeLessThan(
        viewport.height * 0.2
      );
      expect(geometry.logo, `visible logo at ${viewport.width}px`).not.toBeNull();

      if (geometry.logo) {
        const renderedRatio = geometry.logo.width / geometry.logo.height;
        const intrinsicRatio = geometry.logo.naturalWidth / geometry.logo.naturalHeight;
        expect(
          Math.abs(renderedRatio - intrinsicRatio),
          `logo aspect ratio at ${viewport.width}px`
        ).toBeLessThan(0.08);
      }

      expect(geometry.homeIcons.length, `home icons at ${viewport.width}px`).toBeGreaterThan(0);
      for (const [index, icon] of geometry.homeIcons.entries()) {
        const renderedRatio = icon.width / icon.height;
        const intrinsicRatio = icon.naturalWidth / icon.naturalHeight;
        expect(
          Math.abs(renderedRatio - intrinsicRatio),
          `home icon ${index + 1} aspect ratio at ${viewport.width}px`
        ).toBeLessThan(0.08);
      }
    }
  });

  test('mobile navigation opens, closes, and resets cleanly across the desktop breakpoint', async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/', { waitUntil: 'load' });

    const header = page.locator('header');
    const trigger = page.locator('#menu-btn');
    const menu = page.locator('#mainmenu');

    await expect(header).toHaveClass(/header-mobile/);
    await expect(trigger).toHaveAttribute('aria-controls', 'mainmenu');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toHaveAttribute('aria-hidden', 'true');

    await trigger.click();
    await expect(header).toHaveClass(/menu-open/);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(menu).toHaveAttribute('aria-hidden', 'false');
    await expect(page.locator('body')).toHaveClass(/mobile-menu-open/);
    await expect(menu.locator('a:visible').first()).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(header).not.toHaveClass(/menu-open/);
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('body')).not.toHaveClass(/mobile-menu-open/);
    await expect(trigger).toBeFocused();

    await page.setViewportSize({ width: 993, height: 900 });
    await expect(header).not.toHaveClass(/header-mobile/);
    await expect(menu).not.toHaveAttribute('aria-hidden', /.+/);
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
