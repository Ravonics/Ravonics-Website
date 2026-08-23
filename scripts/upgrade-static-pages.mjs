#!/usr/bin/env node

/**
 * Mechanical accessibility and media pass for the legacy HTML routes.
 *
 * This deliberately preserves the existing visual classes and CSS while
 * improving the document semantics, control names, and layout-stability
 * metadata that a future Astro build can validate.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const LIVE_ROOTS = ['', 'capabilities', 'solutions', 'industries', 'company', 'insights'];
const ROOT_PAGES = new Set(['index.html', 'contact.html', 'booking.html', 'privacy.html', 'terms.html']);
const INSIGHT_TAG_ROUTES = new Map([
  ['AI & Machine Learning', '../capabilities/ai.html'],
  ['Autonomous Systems', '../capabilities/autonomous-systems.html'],
  ['Cybersecurity', '../solutions/zero-trust.html'],
  ['Systems Integration', '../capabilities/integration.html'],
  ['Emerging Technologies', '../insights/innovation.html'],
  ['Real-Time Processing', '../capabilities/computing.html'],
  ['Mission Critical', '../capabilities/integration.html'],
  ['Defense Technology', '../industries/defense.html'],
  ['Edge Computing', '../capabilities/computing.html'],
  ['JADC2', '../solutions/jadc2.html'],
  ['Zero Trust', '../solutions/zero-trust.html'],
  ['Post-Quantum Crypto', '../capabilities/cryptography.html']
]);
const cache = new Map();

async function htmlFiles() {
  const files = [];
  for (const dir of LIVE_ROOTS) {
    const absolute = path.join(ROOT, dir);
    const entries = await fs.readdir(absolute, { withFileTypes: true });
    for (const entry of entries) {
      if (dir === '' && (!entry.isFile() || !ROOT_PAGES.has(entry.name))) continue;
      if (dir !== '' && (!entry.isFile() || !entry.name.endsWith('.html'))) continue;
      files.push(path.join(dir, entry.name));
    }
  }
  return files.sort();
}

function classedAttributes(attributes, classes) {
  if (/\bclass\s*=\s*["'][^"']*["']/i.test(attributes)) {
    return attributes.replace(/(\bclass\s*=\s*["'])([^"']*)(["'])/i, (_, start, current, end) => {
      const merged = `${current} ${classes}`.split(/\s+/).filter(Boolean);
      return `${start}${[...new Set(merged)].join(' ')}${end}`;
    });
  }
  return ` class="${classes}"${attributes}`;
}

function convertHeading(text, from, to, visualClass) {
  const opening = new RegExp(`<h${from}(\\b[^>]*)>`, 'gi');
  const closing = new RegExp(`</h${from}>`, 'gi');
  return text
    .replace(
      opening,
      (_, attributes) => `<h${to}${classedAttributes(attributes, `legacy-h${from} ${visualClass}`)}>`
    )
    .replace(closing, `</h${to}>`);
}

function metadataFrom(html, fallbackRoute) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || fallbackRoute;
  const description =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] ||
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)?.[1] ||
    '';
  const canonical =
    html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i)?.[1] ||
    `https://ravonics.com/${fallbackRoute === 'index.html' ? '' : fallbackRoute}`;
  return { title, description, canonical };
}

function removePlaceholderIntegrations(html) {
  let output = html;

  // Do not ship unverified Search Console metadata or a fake analytics ID.
  // Removing the complete block also prevents a useless third-party request.
  output = output.replace(
    /^[ \t]*(?:<!-- Google Search Console verification -->[ \t]*\r?\n[ \t]*)?<meta\b[^>]*name=["']google-site-verification["'][^>]*content=["']PLACEHOLDER_VERIFICATION_CODE["'][^>]*>[ \t]*\r?\n?/gim,
    ''
  );
  output = output.replace(
    /^[ \t]*<!-- Google tag \(gtag\.js\) - Google Analytics 4 -->[ \t]*\r?\n[ \t]*<script\b[^>]*src=["']https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-X{6,}["'][^>]*><\/script>[ \t]*\r?\n[ \t]*<script>[\s\S]*?<\/script>[ \t]*\r?\n?/gim,
    ''
  );
  output = output.replace(/^[ \t]*<link rel="preconnect"/gm, '    <link rel="preconnect"');

  return output;
}

function hardenContentSecurityPolicy(html) {
  return html.replace(
    /(<meta\s+http-equiv=["']Content-Security-Policy["']\s+content=")([^"]*)("[^>]*>)/gi,
    (_, start, policy, end) => {
      const directives = [];
      for (const rawDirective of policy.split(';')) {
        const directive = rawDirective.trim();
        if (!directive) continue;

        // A previous malformed pass could leave the default-src source as a
        // standalone token. Restore the safe default and discard that token.
        if (directive === "'self'") {
          if (!directives.some((entry) => /^default-src\b/i.test(entry))) {
            directives.unshift("default-src 'self'");
          }
          continue;
        }

        const [name, ...sources] = directive.split(/\s+/);
        if (name.toLowerCase() === 'default-src' && sources.length === 0) {
          directives.push("default-src 'self'");
          continue;
        }
        const filtered = sources.filter((source) => {
          if (
            source === 'https://www.googletagmanager.com' ||
            source === 'https://www.google-analytics.com'
          ) {
            return false;
          }
          return name.toLowerCase() !== 'script-src' || source !== "'unsafe-eval'";
        });
        directives.push([name, ...filtered].join(' '));
      }

      if (!directives.some((directive) => /^object-src\b/i.test(directive))) {
        directives.push("object-src 'none'");
      }
      if (!directives.some((directive) => /^form-action\b/i.test(directive))) {
        directives.push("form-action 'self'");
      }

      return `${start}${directives.join('; ')}${end}`;
    }
  );
}

function repairInsightTagLinks(html, route) {
  if (!route.startsWith('insights/')) return html;

  let output = html.replace(/<a\s+href=["']#link["']>([^<]+)<\/a>/gi, (_, label) => {
    const cleanLabel = label.trim();
    const target = INSIGHT_TAG_ROUTES.get(cleanLabel);
    return target ? `<a href="${target}">${label}</a>` : `<span>${label}</span>`;
  });
  output = output.replace(/<span>\s*Mission Critical\s*<\/span>/gi, () => {
    const target = INSIGHT_TAG_ROUTES.get('Mission Critical');
    return `<a href="${target}">Mission Critical</a>`;
  });

  if (route === 'insights/innovation.html') {
    output = output.replace(/<a\s+href=["']#["']>Insights<\/a>/i, '<a href="blog.html">Insights</a>');
  }

  return output;
}

async function dimensionsFor(file) {
  if (cache.has(file)) return cache.get(file);
  let dimensions = null;
  try {
    const metadata = await sharp(file).metadata();
    if (metadata.width && metadata.height) dimensions = { width: metadata.width, height: metadata.height };
  } catch {
    try {
      const svg = await fs.readFile(file, 'utf8');
      const viewBox = svg.match(/viewBox\s*=\s*["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)/i);
      if (viewBox) dimensions = { width: Number(viewBox[1]), height: Number(viewBox[2]) };
    } catch {
      dimensions = null;
    }
  }
  cache.set(file, dimensions);
  return dimensions;
}

async function addImageDimensions(html, sourceFile) {
  const imagePattern = /<img\b([^>]*?)>/gi;
  let output = '';
  let cursor = 0;
  let match;
  let added = 0;
  while ((match = imagePattern.exec(html))) {
    output += html.slice(cursor, match.index);
    let tagAttributes = match[1];
    const source = tagAttributes.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
    if (source && !/^(?:[a-z]+:|\/\/|data:|#)/i.test(source)) {
      const cleanSource = decodeURIComponent(source.split(/[?#]/, 1)[0]);
      const imageFile = path.resolve(path.dirname(sourceFile), cleanSource);
      if (imageFile.startsWith(ROOT + path.sep)) {
        const dimensions = await dimensionsFor(imageFile);
        if (dimensions && !/\bwidth\s*=/.test(tagAttributes) && !/\bheight\s*=/.test(tagAttributes)) {
          tagAttributes += ` width="${dimensions.width}" height="${dimensions.height}"`;
          added += 1;
        }
      }
    }
    output += `<img${tagAttributes}>`;
    cursor = imagePattern.lastIndex;
  }
  output += html.slice(cursor);
  return { html: output, added };
}

function improveStructure(html, route) {
  let output = html;

  output = removePlaceholderIntegrations(output);
  output = hardenContentSecurityPolicy(output);
  output = repairInsightTagLinks(output, route);

  // Preserve existing styles while giving the content and navigation regions
  // their correct landmark semantics.
  output = output.replace(
    /<div(\s+[^>]*\bid=["']content["'][^>]*)\s+role=["']main["']([^>]*)>/gi,
    '<main$1$2>'
  );
  output = output.replace(/(<main\b[\s\S]*?)\n(\s*)<\/div>(\n\s*<!-- content close -->)/i, '$1\n$2</main>$3');
  output = output.replace(
    /<div(\s+[^>]*class=["'][^"']*\bheader-col-mid\b[^"']*["'][^>]*)>/i,
    '<nav$1 aria-label="Primary navigation">'
  );
  output = output.replace(/(<ul\s+id=["']mainmenu["'])\s+role=["']navigation["']/i, '$1');
  output = output.replace(/(<!-- mainmenu end -->\n\s*)<\/div>/i, '$1</nav>');

  // Native controls retain the existing IDs and classes consumed by the
  // purchased template's JavaScript.
  output = output.replace(
    /<a\s+href=["']javascript:void\(0\)["']\s+id=["']menu-btn["'][^>]*><\/a>/gi,
    '<button type="button" id="menu-btn" aria-label="Open navigation" aria-expanded="false"></button>'
  );
  output = output.replace(
    /<a\b([^>]*\bhref=["']javascript:void\(0\)["'][^>]*)>([\s\S]*?)<\/a>/gi,
    (match, attributes, content) => {
      if (!/\bonclick\s*=\s*["']playHeroVideo\(\)["']/i.test(attributes)) return match;
      const withoutHref = attributes.replace(/\s+href=["']javascript:void\(0\)["']/i, '');
      const phrasingContent = content.replace(/<div\b/gi, '<span').replace(/<\/div>/gi, '</span>');
      return `<button type="button"${withoutHref}>${phrasingContent}</button>`;
    }
  );
  output = output.replace(
    /(<button\b[^>]*\bonclick=["']playHeroVideo\(\)["'][^>]*>)([\s\S]*?)(<\/button>)/gi,
    (_, opening, content, closing) =>
      `${opening}${content.replace(/<div\b/gi, '<span').replace(/<\/div>/gi, '</span>')}${closing}`
  );
  output = output.replace(/<button\b([^>]*\bid=["']menu-btn["'][^>]*)>/gi, (match, attributes) =>
    /\baria-controls\s*=/.test(attributes) ? match : `<button${attributes} aria-controls="mainmenu">`
  );
  output = output.replace(
    /<div\s+id=["']btn-extra["']>([\s\S]*?)<\/div>/gi,
    '<button type="button" id="btn-extra" aria-label="Open information panel">$1</button>'
  );
  output = output.replace(
    /<div\s+id=["']btn-close["']>([\s\S]*?)<\/div>/gi,
    '<button type="button" id="btn-close" aria-label="Close information panel">$1</button>'
  );
  output = output.replace(
    /<div\s+id=["']extra-wrap["']([^>]*)>/gi,
    '<div role="dialog" aria-modal="true" aria-label="Additional navigation" tabindex="-1" aria-hidden="true" inert id="extra-wrap"$1>'
  );
  output = output.replace(
    /(<div\s+role=["']dialog["'][^>]*\baria-hidden=["']true["'])(\s+)(id=["']extra-wrap["'])/gi,
    '$1 inert$2$3'
  );
  output = output.replace(
    /<a\s+href=["']#["']\s+id=["']back-to-top["'](?![^>]*\baria-label=)([^>]*)>/gi,
    '<a href="#" id="back-to-top" aria-label="Back to top"$1>'
  );
  if (!/id=["']back-to-top-region["']/i.test(output)) {
    output = output.replace(
      /(\s*)<a(\s+href=["']#["']\s+id=["']back-to-top["'][^>]*)><\/a>/gi,
      '$1<div id="back-to-top-region" role="region" aria-label="Page navigation">\n$1  <a$2></a>\n$1</div>'
    );
  }
  let dedupedBackToTop;
  do {
    dedupedBackToTop = output;
    output = output.replace(
      /<div id=["']back-to-top-region["']([^>]*)>\s*<div id=["']back-to-top-region["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi,
      '<div id="back-to-top-region"$1>$2</div>'
    );
  } while (output !== dedupedBackToTop);
  output = output.replace(
    /([ \t]*)<div id=["']back-to-top-region["'][^>]*>\s*<a\s+href=["']#["']\s+id=["']back-to-top["'][^>]*><\/a>\s*<\/div>/gi,
    (_, indent) =>
      `${indent}<div id="back-to-top-region" role="region" aria-label="Page navigation">\n\n${indent}  <a href="#" id="back-to-top" aria-label="Back to top"></a>\n\n${indent}</div>`
  );
  output = output.replace(
    /<div\s+role=["']dialog["']\s+aria-modal=["']true["']\s+aria-label=["']Additional navigation["']\s+tabindex=["']-1["']\s+aria-hidden=["']true["']\s+id=["']extra-content["']/gi,
    '<div id="extra-content"'
  );
  output = output.replace(
    /<div\s+class=["']swiper-button-prev["']><\/div>/gi,
    '<button type="button" class="swiper-button-prev" aria-label="Previous slide"></button>'
  );
  output = output.replace(
    /<div\s+class=["']swiper-button-next["']><\/div>/gi,
    '<button type="button" class="swiper-button-next" aria-label="Next slide"></button>'
  );
  output = output.replace(
    /<a\s+class=["']btn-next["']\s+aria-label=["']Next slide["']><\/a>/gi,
    '<button type="button" class="btn-next" aria-label="Next slide"></button>'
  );
  output = output.replace(
    /<a\s+class=["']btn-prev["']\s+aria-label=["']Previous slide["']><\/a>/gi,
    '<button type="button" class="btn-prev" aria-label="Previous slide"></button>'
  );

  // Repair the repeated heading outline without changing the established
  // visual scale: Bootstrap's h4/h5/h6 utility classes retain the old sizing.
  output = convertHeading(output, 6, 3, 'h6');
  output = convertHeading(output, 5, 2, 'h5');
  output = convertHeading(output, 4, 2, 'h4');

  if (/^insights\//.test(route) && /class=["']blog-read["']/.test(output) && !/<article\b/i.test(output)) {
    output = output.replace(
      /<div\s+class=["']blog-read["']>/i,
      '<article class="blog-read" aria-label="Article content">'
    );
    output = output.replace(
      /(<article\b[^>]*class=["']blog-read["'][\s\S]*?)\n(\s*)<\/div>(\s*)(?=<div\s+class=["']spacer-single["'])/i,
      '$1\n$2</article>$3'
    );
  }

  // This is a valid, generated feed target even before the Astro route is
  // enabled by deployment; relative page depth should not affect it.
  if (!/rel=["']alternate["'][^>]+type=["']application\/rss\+xml["']/i.test(output)) {
    output = output.replace(
      /<\/head>/i,
      '    <link rel="alternate" type="application/rss+xml" href="/rss.xml" title="Ravonics Insights">\n</head>'
    );
  }

  const assetPrefix = '../'.repeat(Math.max(0, route.split('/').length - 1));
  if (!/src=["'][^"']*js\/accessibility\.js["']/i.test(output)) {
    output = output.replace(
      /<\/body>/i,
      `    <script src="${assetPrefix}js/accessibility.js" defer></script>\n</body>`
    );
  }

  // The video poster is meaningful content, not decorative whitespace.
  output = output.replace(
    /(<img\s+src=["'][^"']*background\/1\.avif["'][^>]*\balt=)["']["']/i,
    '$1"Ravonics overview video: mission-ready technology for federal operations"'
  );

  // Add a conservative WebPage/CollectionPage record only where no schema
  // exists. Existing page-specific structured data remains untouched.
  if (
    !/<script[^>]+type=["']application\/ld\+json["']/i.test(output) &&
    /^(insights\/gallery|insights\/testimonials)\.html$/.test(route)
  ) {
    const metadata = metadataFrom(output, route);
    const type = route.endsWith('gallery.html') ? 'CollectionPage' : 'WebPage';
    const schema = {
      '@context': 'https://schema.org',
      '@type': type,
      name: metadata.title,
      description: metadata.description,
      url: metadata.canonical,
      isPartOf: { '@type': 'WebSite', name: 'Ravonics', url: 'https://ravonics.com/' },
      publisher: { '@type': 'Organization', name: 'Ravonics LLC', url: 'https://ravonics.com/' }
    };
    output = output.replace(
      /<\/head>/i,
      `    <script type="application/ld+json">${JSON.stringify(schema)}</script>\n</head>`
    );
  }

  return output;
}

const files = await htmlFiles();
let changed = 0;
let imagesSized = 0;
for (const relative of files) {
  const file = path.join(ROOT, relative);
  const original = await fs.readFile(file, 'utf8');
  let updated = improveStructure(original, relative);
  const sized = await addImageDimensions(updated, file);
  updated = sized.html;
  imagesSized += sized.added;
  if (updated !== original) {
    await fs.writeFile(file, updated);
    changed += 1;
  }
}

console.log(JSON.stringify({ files: files.length, changed, imagesSized, cachedImages: cache.size }));
