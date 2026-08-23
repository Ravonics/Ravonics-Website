#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { collectLiveRoutes, ROOT } from './site-routes.mjs';

const routes = collectLiveRoutes();
const errors = [];
const localReferencePattern = /((?:src|href|poster|data-src|data-bgimage))\s*=\s*["']([^"']+)["']/gi;
const placeholderVerificationPattern = /\b(?:PLACEHOLDER_VERIFICATION_CODE|G-XXXXXXXXXX)\b/gi;
const cspMetaPattern = /<meta\b[^>]*http-equiv=["']content-security-policy["'][^>]*>/gi;
const analyticsOriginPattern =
  /https?:\/\/(?:www\.)?(?:googletagmanager\.com|google-analytics\.com)(?:[\/\s"')]|$)/gi;

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

  const cspTags = [...html.matchAll(cspMetaPattern)].map((match) => match[0]);
  if (cspTags.length !== 1) {
    errors.push(`${page.source}: expected one Content-Security-Policy meta tag, found ${cspTags.length}`);
  } else {
    const cspContent = cspTags[0].match(/\bcontent=(['"])([\s\S]*?)\1/i)?.[2] || '';
    const directives = new Map(
      cspContent
        .split(';')
        .map((directive) => directive.trim().split(/\s+/))
        .filter(([name]) => name)
        .map(([name, ...sources]) => [name.toLowerCase(), sources])
    );
    const requiredCspSources = [
      ['default-src', "'self'"],
      ['object-src', "'none'"],
      ['form-action', "'self'"]
    ];
    const invalidDirectives = requiredCspSources
      .filter(([name, source]) => !directives.get(name)?.includes(source))
      .map(([name, source]) => `${name} ${source}`);
    if (invalidDirectives.length) {
      errors.push(`${page.source}: CSP missing required directive(s): ${invalidDirectives.join(', ')}`);
    }
    if (directives.get('script-src')?.includes("'unsafe-eval'")) {
      errors.push(`${page.source}: CSP script-src must not allow 'unsafe-eval'`);
    }
  }

  const analyticsOrigins = [...html.matchAll(analyticsOriginPattern)].map((match) => match[0].trim());
  if (analyticsOrigins.length) {
    errors.push(
      `${page.source}: unapproved analytics origin(s): ${[...new Set(analyticsOrigins)].join(', ')}`
    );
  }

  const backToTopRegions = (html.match(/\bid=["']back-to-top-region["']/gi) || []).length;
  if (backToTopRegions > 1) {
    errors.push(`${page.source}: duplicate id="back-to-top-region" (${backToTopRegions} occurrences)`);
  }

  const placeholderTokens = html.match(placeholderVerificationPattern) || [];
  if (placeholderTokens.length) {
    errors.push(
      `${page.source}: placeholder verification/analytics token(s): ${[
        ...new Set(placeholderTokens.map((token) => token.toUpperCase()))
      ].join(', ')}`
    );
  }

  const deadHrefs = [...html.matchAll(/\bhref\s*=\s*["']((?:#link|javascript:)[^"']*)["']/gi)].map((match) =>
    match[1].trim()
  );
  if (deadHrefs.length) {
    errors.push(`${page.source}: dead href target(s): ${[...new Set(deadHrefs)].join(', ')}`);
  }

  const unapprovedBareHashLinks = [...html.matchAll(/<a\b([^>]*\bhref\s*=\s*["']#["'][^>]*)>/gi)]
    .map((match) => match[1])
    .filter(
      (attributes) =>
        !/\bid\s*=\s*["']back-to-top["']/i.test(attributes) &&
        !/\bdata-bs-toggle\s*=\s*["']modal["']/i.test(attributes) &&
        !/\bdata-filter\s*=/i.test(attributes)
    );
  if (unapprovedBareHashLinks.length) {
    errors.push(`${page.source}: unapproved bare href="#" link(s): ${unapprovedBareHashLinks.length}`);
  }

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
