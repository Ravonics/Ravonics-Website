#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { collectLiveRoutes, ROOT } from './site-routes.mjs';

const routes = collectLiveRoutes();
const errors = [];
const localReferencePattern = /((?:src|href|poster|data-src|data-bgimage))\s*=\s*["']([^"']+)["']/gi;

function isLocal(value) {
  return value && !/^(?:[a-z]+:|\/\/|#|javascript:|mailto:|tel:|data:)/i.test(value);
}

function referencesFor(attribute, value) {
  if (attribute.toLowerCase() !== 'data-bgimage') return [value];
  return [...value.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)].map((match) => match[1]);
}

function resolveReference(page, reference) {
  const clean = reference.split(/[?#]/, 1)[0];
  if (clean.startsWith('/')) return path.join(ROOT, clean);
  return path.resolve(path.dirname(path.join(ROOT, page.source)), clean);
}

for (const page of routes) {
  const { html } = page;
  const headingCount = (html.match(/<h1\b/gi) || []).length;
  if (!page.title) errors.push(`${page.source}: missing title`);
  if (!page.description) errors.push(`${page.source}: missing description`);
  if (!page.canonical) errors.push(`${page.source}: missing canonical`);
  if (!/^https:\/\/ravonics\.com(?:\/|$)/.test(page.canonical))
    errors.push(`${page.source}: invalid canonical ${page.canonical}`);
  if (headingCount !== 1) errors.push(`${page.source}: expected one h1, found ${headingCount}`);
  if ((html.match(/<main\b/gi) || []).length !== 1) errors.push(`${page.source}: expected one main landmark`);
  if ((html.match(/<nav\b/gi) || []).length < 1) errors.push(`${page.source}: missing nav landmark`);

  let match;
  while ((match = localReferencePattern.exec(html))) {
    for (const reference of referencesFor(match[1], match[2])) {
      if (!isLocal(reference) || reference.endsWith('/')) continue;
      const resolved = resolveReference(page, reference);
      if (resolved.startsWith(ROOT + path.sep) && !fs.existsSync(resolved)) {
        errors.push(`${page.source}: missing local reference ${reference}`);
      }
    }
  }
}

const indexPage = routes.find((page) => page.route === '/');
if (!indexPage) errors.push('route ledger has no home page');
if (routes.some((page) => page.route.includes('/src/')))
  errors.push('route ledger includes source-only pages');

if (errors.length) {
  console.error(`Site quality failed with ${errors.length} error(s):`);
  errors.slice(0, 80).forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}
console.log(`Site quality passed: ${routes.length} routes, semantic landmarks and local references valid.`);
