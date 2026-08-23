/**
 * qa-screenshots.mjs — Ravonics static-site visual & programmatic QA gate
 *
 * USAGE:
 *   node scripts/qa-screenshots.mjs [--pages page1.html,page2.html]
 *
 * WHAT IT CHECKS:
 *   1. Spawns a python3 HTTP server at localhost:8099 rooted at the production
 *      artifact when available (falling back to the repo for ad hoc use).
 *   2. Screenshots a configurable page list at desktop (1440×900) and mobile
 *      (390×844), full-page, using Chromium. Saves PNGs under build/visual-audit/.
 *   3. SKEW/OVERSIZE CHECK: For every visible content <img> with naturalWidth>0,
 *      computes displayed vs natural aspect ratio. Flags >2% distortion OR any
 *      image wider than its viewport (overflow/oversize). Also flags 404 images.
 *   4. HORIZONTAL SCROLL CHECK: Flags any page where scrollWidth > viewport+8px.
 *   5. FIREFOX CONSOLE CHECK: Loads index.html and capabilities/ai.html in Firefox,
 *      captures all console messages and errors, reports any "Glyph bbox was
 *      incorrect" or font/image 404 warnings.
 *   6. Exits non-zero on any violation; prints clear PASS/FAIL summary.
 *
 * REQUIREMENTS:
 *   - Node.js ≥24 (ESM)
 *   - npm install (uses the repository's pinned Playwright)
 *   - Chromium & Firefox installed with `npx playwright install`
 *   - python3 in PATH
 *
 * OUTPUT:
 *   Screenshots → build/visual-audit/<pagename>__<viewport>.png
 *   Console:      structured PASS/FAIL per check, then overall verdict.
 */

import { chromium, firefox } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectLiveRoutes } from './site-routes.mjs';

// ── Configuration ──────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const BUILD_ROOT = join(REPO_ROOT, 'build', 'site');
const SERVER_ROOT = existsSync(BUILD_ROOT) ? BUILD_ROOT : REPO_ROOT;
const OUT_DIR = process.env.RAVONICS_QA_OUT || join(REPO_ROOT, 'build', 'visual-audit');
const PORT = 8099;
const BASE_URL = `http://localhost:${PORT}`;

// Parse optional --pages flag
const pagesArg = process.argv.find((a, i) => process.argv[i - 1] === '--pages');
const RUN_LIVE_COMPARISON = process.argv.includes('--live');
const DEFAULT_PAGES = collectLiveRoutes().map((route) => route.source);
const PAGES = pagesArg ? pagesArg.split(',').map((s) => s.trim()) : DEFAULT_PAGES;

const FIREFOX_CHECK_PAGES = ['index.html', 'capabilities/ai.html'];

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 }
];

const SKEW_THRESHOLD = 0.02; // 2% aspect ratio distortion
const H_SCROLL_TOLERANCE = 8; // px of horizontal overflow to tolerate

// ── Utilities ──────────────────────────────────────────────────────────────────

function pageSlug(pagePath) {
  // 'capabilities/ai.html' → 'capabilities__ai'
  return pagePath.replace(/\.html$/, '').replace(/\//g, '__');
}

function log(msg) {
  console.log(msg);
}
function warn(msg) {
  console.warn('\x1b[33m' + msg + '\x1b[0m');
}
function fail(msg) {
  console.error('\x1b[31m✗ ' + msg + '\x1b[0m');
}
function pass(msg) {
  console.log('\x1b[32m✓ ' + msg + '\x1b[0m');
}

// ── Server management ──────────────────────────────────────────────────────────

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', ['-m', 'http.server', String(PORT)], {
      cwd: SERVER_ROOT,
      // The server logs every asset request. Leaving stdout/stderr as unread
      // pipes eventually fills their buffers and deadlocks an all-route run.
      stdio: 'ignore'
    });

    let ready = false;
    const timer = setTimeout(() => {
      if (!ready) reject(new Error('Server did not start in time'));
    }, 10_000);

    // Poll for server readiness
    const poller = setInterval(async () => {
      try {
        const resp = await fetch(`${BASE_URL}/index.html`);
        if (resp.ok && !ready) {
          ready = true;
          clearInterval(poller);
          clearTimeout(timer);
          log(`Server up at ${BASE_URL} (pid ${proc.pid})`);
          resolve(proc);
        }
      } catch {
        /* not up yet */
      }
    }, 200);

    proc.on('error', (e) => {
      clearInterval(poller);
      clearTimeout(timer);
      reject(e);
    });
    proc.on('exit', (code) => {
      if (!ready) {
        clearInterval(poller);
        clearTimeout(timer);
        reject(new Error(`Server exited with code ${code}`));
      }
    });
  });
}

function stopServer(proc) {
  try {
    proc.kill('SIGTERM');
  } catch {}
}

// ── Image skew / oversize check ────────────────────────────────────────────────

async function checkImagesOnPage(page, pagePath, viewportWidth) {
  const violations = await page.evaluate(
    ({ skewThreshold, hScrollTolerance, viewportWidth }) => {
      const results = { skew: [], broken: [], hScroll: null };

      // Horizontal scroll check
      const scrollW = document.scrollingElement?.scrollWidth ?? document.documentElement.scrollWidth;
      if (scrollW > viewportWidth + hScrollTolerance) {
        results.hScroll = { scrollWidth: scrollW, viewportWidth };
      }

      // Image checks
      const imgs = Array.from(document.querySelectorAll('img'));
      for (const img of imgs) {
        // Skip template/hidden/icon images
        if (img.offsetParent === null && img.style.display === 'none') continue;
        const rect = img.getBoundingClientRect();

        // Broken image
        if (img.naturalWidth === 0 && img.complete) {
          results.broken.push({
            src: img.src || img.getAttribute('src'),
            rendered: `${Math.round(rect.width)}x${Math.round(rect.height)}`
          });
          continue;
        }

        // Only check images that have loaded and are visible
        if (img.naturalWidth === 0 || rect.width < 4 || rect.height < 4) continue;

        const naturalAspect = img.naturalWidth / img.naturalHeight;
        const displayedAspect = rect.width / rect.height;
        const delta = Math.abs(displayedAspect - naturalAspect) / naturalAspect;
        const objectFit = getComputedStyle(img).objectFit;
        const intentionallyArtDirected = ['contain', 'cover', 'scale-down'].includes(objectFit);

        // Oversize: rendered width wider than viewport
        const oversize = rect.width > viewportWidth + 4;

        if ((delta > skewThreshold && !intentionallyArtDirected) || oversize) {
          results.skew.push({
            src: (img.src || img.getAttribute('src') || '').replace(location.origin, ''),
            displayedW: Math.round(rect.width),
            displayedH: Math.round(rect.height),
            naturalW: img.naturalWidth,
            naturalH: img.naturalHeight,
            aspectDelta: Math.round(delta * 1000) / 10 + '%',
            oversize
          });
        }
      }
      return results;
    },
    { skewThreshold: SKEW_THRESHOLD, hScrollTolerance: H_SCROLL_TOLERANCE, viewportWidth }
  );

  return violations;
}

// ── Firefox console check ──────────────────────────────────────────────────────

async function runFirefoxConsoleCheck(pages) {
  log('\n── Firefox console check ──────────────────────────────────────');
  const browser = await firefox.launch({ headless: true });
  const results = [];

  for (const pagePath of pages) {
    const url = `${BASE_URL}/${pagePath}`;
    log(`  Firefox → ${url}`);
    const context = await browser.newContext();
    const page = await context.newPage();

    const messages = [];
    const failures = [];

    page.on('console', (msg) => {
      messages.push({ type: msg.type(), text: msg.text() });
    });
    page.on('pageerror', (err) => {
      failures.push(err.message);
    });
    page.on('requestfailed', (req) => {
      const url = req.url();
      if (/\.(woff2?|ttf|otf|eot|png|jpg|jpeg|gif|svg|webp)$/i.test(url)) {
        failures.push(`RESOURCE FAILED: ${url}`);
      }
    });

    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
      // Give a beat for deferred font loading warnings
      await page.waitForTimeout(1500);
    } catch (e) {
      failures.push(`Navigation error: ${e.message}`);
    }

    await context.close();

    const glyphWarnings = messages.filter(
      (m) => /glyph bbox was incorrect/i.test(m.text) || /glyf.*incorrect/i.test(m.text)
    );
    const fontImageFails = failures.filter(
      (f) => /\.(woff2?|ttf|otf|eot|png|jpg|jpeg|gif|svg|webp)/i.test(f) || /RESOURCE FAILED/i.test(f)
    );
    const otherErrors = failures.filter((f) => !fontImageFails.includes(f));

    results.push({ pagePath, messages, failures, glyphWarnings, fontImageFails, otherErrors });
  }

  await browser.close();
  return results;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  log(`\nRavonics QA Gate — screenshots → ${OUT_DIR}`);
  log(`Pages: ${PAGES.join(', ')}`);
  log(`Viewports: ${VIEWPORTS.map((v) => v.name).join(', ')}\n`);

  let server;
  let overallViolations = [];
  let screenshotPaths = [];

  try {
    // Start static server
    server = await startServer();

    // ── Chromium: screenshot + programmatic checks ────────────────────────────
    log('\n── Chromium screenshot + image checks ─────────────────────────');
    let browser = await chromium.launch({ headless: true });

    for (const [pageIndex, pagePath] of PAGES.entries()) {
      const slug = pageSlug(pagePath);
      const url = `${BASE_URL}/${pagePath}`;

      for (const vp of VIEWPORTS) {
        const outFile = join(OUT_DIR, `${slug}__${vp.name}.png`);
        log(`  [${vp.name}] ${url}`);

        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          deviceScaleFactor: 1
        });
        await context.route(/^https?:\/\//, (route) => {
          const requestUrl = new URL(route.request().url());
          const isLocal = requestUrl.origin === BASE_URL;
          return isLocal ? route.continue() : route.abort();
        });
        const page = await context.newPage();
        await page.emulateMedia({ reducedMotion: 'reduce' });

        // Capture console errors (not treated as violations but logged)
        const consoleErrors = [];
        page.on('console', (msg) => {
          if (msg.type() === 'error') consoleErrors.push(msg.text());
        });

        try {
          // Third-party anti-abuse widgets deliberately keep network activity
          // alive. The load event plus a short settle is deterministic locally.
          await page.goto(url, { waitUntil: 'commit', timeout: 30_000 });
          await page.locator('main').waitFor({ state: 'attached', timeout: 10_000 });
          // Let lazy-loaded images settle
          await page.waitForTimeout(800);

          // Exercise reveal-on-scroll sections and lazy media before the
          // full-page capture. Without this, a screenshot can contain blank
          // regions that a real visitor would reveal while reading.
          await page.evaluate(async () => {
            const delay = (milliseconds) =>
              new Promise((resolve) => window.setTimeout(resolve, milliseconds));
            const step = Math.max(Math.floor(window.innerHeight * 0.8), 400);
            for (let position = 0; position < document.documentElement.scrollHeight; position += step) {
              window.scrollTo(0, position);
              await delay(60);
            }
            window.scrollTo(0, 0);
          });
          await page.waitForTimeout(200);

          // Screenshot full page
          await page.screenshot({ path: outFile, fullPage: true });
          screenshotPaths.push(outFile);
          log(`    saved → ${outFile}`);

          // Image + scroll checks
          const violations = await checkImagesOnPage(page, pagePath, vp.width);

          if (violations.hScroll) {
            overallViolations.push({
              kind: 'horizontal-scroll',
              page: pagePath,
              viewport: vp.name,
              detail: `scrollWidth ${violations.hScroll.scrollWidth}px > viewport ${vp.width}px`
            });
          }

          for (const v of violations.skew) {
            overallViolations.push({
              kind: v.oversize ? 'oversize' : 'skew',
              page: pagePath,
              viewport: vp.name,
              src: v.src,
              displayedWxH: `${v.displayedW}x${v.displayedH}`,
              naturalWxH: `${v.naturalW}x${v.naturalH}`,
              aspectDelta: v.aspectDelta
            });
          }

          for (const b of violations.broken) {
            overallViolations.push({
              kind: 'broken-image',
              page: pagePath,
              viewport: vp.name,
              src: b.src
            });
          }

          // Log console errors (informational, not counted as violations)
          if (consoleErrors.length > 0) {
            warn(`    console errors (${consoleErrors.length}): ${consoleErrors.slice(0, 3).join(' | ')}`);
          }
        } catch (e) {
          fail(`    ERROR loading ${url} [${vp.name}]: ${e.message}`);
          overallViolations.push({
            kind: 'load-error',
            page: pagePath,
            viewport: vp.name,
            detail: e.message
          });
        }

        await context.close();
      }

      // Full-page screenshots retain renderer state. Recycling periodically
      // keeps long audits deterministic on constrained CI runners.
      if ((pageIndex + 1) % 6 === 0 && pageIndex < PAGES.length - 1) {
        await browser.close();
        browser = await chromium.launch({ headless: true });
      }
    }

    await browser.close();

    // ── Firefox console check ─────────────────────────────────────────────────
    const firefoxResults = await runFirefoxConsoleCheck(FIREFOX_CHECK_PAGES);

    // ── Live site before/after screenshots ───────────────────────────────────
    if (RUN_LIVE_COMPARISON) {
      log('\n── Optional live-site comparison (https://ravonics.com/) ──────');
      const liveBrowser = await chromium.launch({ headless: true });
      const livePages = ['', 'capabilities/ai.html'];
      const liveLabels = ['index', 'capabilities__ai'];
      for (let i = 0; i < livePages.length; i++) {
        const liveUrl = `https://ravonics.com/${livePages[i]}`;
        const outFile = join(OUT_DIR, `LIVE-before__${liveLabels[i]}__desktop.png`);
        try {
          const context = await liveBrowser.newContext({
            viewport: { width: 1440, height: 900 },
            deviceScaleFactor: 1
          });
          const page = await context.newPage();
          await page.goto(liveUrl, { waitUntil: 'load', timeout: 20_000 });
          await page.waitForTimeout(500);
          await page.screenshot({ path: outFile, fullPage: true });
          await context.close();
          screenshotPaths.push(outFile);
          log(`  Live saved → ${outFile}`);
        } catch (e) {
          warn(`  Live screenshot skipped (network unavailable or error): ${e.message}`);
        }
      }
      await liveBrowser.close();
    }

    // ── Print summary ─────────────────────────────────────────────────────────
    log('\n═══════════════════════════════════════════════════════════════');
    log('QA RESULTS SUMMARY');
    log('═══════════════════════════════════════════════════════════════\n');

    // Chromium image/scroll violations
    if (overallViolations.length === 0) {
      pass('Image/scroll checks: PASS — no skew, oversize, broken images, or horizontal overflow');
    } else {
      fail(`Image/scroll checks: ${overallViolations.length} violation(s)`);
      for (const v of overallViolations) {
        const detail =
          v.kind === 'skew'
            ? `${v.src} displayed=${v.displayedWxH} natural=${v.naturalWxH} delta=${v.aspectDelta}`
            : v.kind === 'oversize'
              ? `${v.src} displayed=${v.displayedWxH} natural=${v.naturalWxH} (wider than viewport)`
              : v.kind === 'horizontal-scroll'
                ? v.detail
                : v.kind === 'broken-image'
                  ? `404/broken: ${v.src}`
                  : v.detail;
        fail(`  [${v.kind}] ${v.page} @ ${v.viewport}: ${detail}`);
      }
    }

    // Firefox console results
    log('');
    let firefoxFailed = false;
    for (const r of firefoxResults) {
      const label = `Firefox/${r.pagePath}`;
      if (r.glyphWarnings.length > 0) {
        fail(`${label}: GLYPH BBOX WARNING PRESENT (${r.glyphWarnings.length}x)`);
        for (const w of r.glyphWarnings) fail(`  → ${w.text}`);
        firefoxFailed = true;
      } else {
        pass(`${label}: No "Glyph bbox was incorrect" warning`);
      }

      if (r.fontImageFails.length > 0) {
        fail(`${label}: Font/image 404s (${r.fontImageFails.length})`);
        for (const f of r.fontImageFails) fail(`  → ${f}`);
        firefoxFailed = true;
      } else {
        pass(`${label}: No font/image 404s`);
      }

      if (r.otherErrors.length > 0) {
        warn(`${label}: Other page errors (${r.otherErrors.length}) — NOT counted as violations:`);
        for (const e of r.otherErrors.slice(0, 5)) warn(`  → ${e}`);
      }

      // Show all console messages for transparency
      if (r.messages.length > 0) {
        const warns = r.messages.filter((m) => m.type === 'warning');
        const errors = r.messages.filter((m) => m.type === 'error');
        if (warns.length + errors.length > 0) {
          warn(
            `  Firefox console: ${errors.length} error(s), ${warns.length} warning(s) (see raw output above for details)`
          );
        }
      }
    }

    // Screenshot list
    log('\n── Screenshot files ───────────────────────────────────────────');
    for (const p of screenshotPaths) {
      log(`  ${p}`);
    }

    // Final verdict
    log('\n═══════════════════════════════════════════════════════════════');
    const totalFails = overallViolations.length + (firefoxFailed ? 1 : 0);
    if (totalFails === 0) {
      pass('OVERALL: PASS');
    } else {
      fail(`OVERALL: FAIL — ${totalFails} issue group(s) found`);
    }
    log('═══════════════════════════════════════════════════════════════\n');

    process.exitCode = totalFails > 0 ? 1 : 0;
  } finally {
    if (server) {
      stopServer(server);
      log('Server stopped.');
    }
  }
}

main().catch((e) => {
  fail(`Fatal: ${e.message}`);
  process.exit(1);
});
