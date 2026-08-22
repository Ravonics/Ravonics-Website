import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const SITE_ORIGIN = 'https://ravonics.com';
const ROOT_PAGES = new Set(['index.html', 'contact.html', 'booking.html', 'privacy.html', 'terms.html']);
const LIVE_DIRECTORIES = ['capabilities', 'solutions', 'industries', 'company', 'insights'];

function htmlFiles(directory, rootOnly) {
  const absolute = path.join(ROOT, directory);
  if (!fs.existsSync(absolute)) return [];
  return fs
    .readdirSync(absolute, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .filter((entry) => !rootOnly || ROOT_PAGES.has(entry.name))
    .map((entry) => path.join(directory, entry.name));
}

function first(html, expression) {
  return html.match(expression)?.[1]?.trim() || '';
}

function kindFor(relative) {
  if (relative === 'index.html') return 'home';
  if (relative === 'contact.html' || relative === 'booking.html') return 'conversion';
  if (relative === 'privacy.html' || relative === 'terms.html') return 'legal';
  const directory = relative.split('/')[0];
  return directory === 'capabilities'
    ? 'capability'
    : directory === 'solutions'
      ? 'solution'
      : directory === 'industries'
        ? 'industry'
        : directory === 'company'
          ? 'company'
          : 'insight';
}

export function routeFor(relative) {
  return relative === 'index.html' ? '/' : `/${relative}`;
}

export function collectLiveRoutes() {
  return [...htmlFiles('', true), ...LIVE_DIRECTORIES.flatMap((directory) => htmlFiles(directory, false))]
    .sort()
    .map((source) => {
      const absolute = path.join(ROOT, source);
      const html = fs.readFileSync(absolute, 'utf8');
      return {
        source,
        route: routeFor(source),
        kind: kindFor(source),
        title: first(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
        description:
          first(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ||
          first(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i),
        canonical: first(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i),
        html
      };
    });
}

export function xmlEscape(value) {
  return String(value).replace(
    /[<>&'\"]/g,
    (character) =>
      ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        "'": '&apos;',
        '"': '&quot;'
      })[character]
  );
}

export function sitemapXml(routes = collectLiveRoutes()) {
  const urls = routes.map(
    (page) => `  <url>\n    <loc>${xmlEscape(`${SITE_ORIGIN}${page.route}`)}</loc>\n  </url>`
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

export function rssXml(routes = collectLiveRoutes()) {
  const items = routes
    .filter((page) => page.kind === 'insight')
    .map(
      (page) =>
        `    <item>\n      <title>${xmlEscape(page.title)}</title>\n      <link>${xmlEscape(`${SITE_ORIGIN}${page.route}`)}</link>\n      <guid isPermaLink="true">${xmlEscape(`${SITE_ORIGIN}${page.route}`)}</guid>\n      <description>${xmlEscape(page.description)}</description>\n    </item>`
    );

  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n  <channel>\n    <title>Ravonics Insights</title>\n    <link>${SITE_ORIGIN}</link>\n    <description>Technical perspectives on federal AI, autonomy, cryptography, cloud, and systems engineering.</description>\n    <language>en-us</language>\n${items.join('\n')}\n  </channel>\n</rss>\n`;
}
