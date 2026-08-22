#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, collectLiveRoutes, rssXml, sitemapXml } from './site-routes.mjs';

const routes = collectLiveRoutes();
const expected = sitemapXml(routes);
const expectedFeed = rssXml(routes);
const sitemapPath = path.join(ROOT, 'sitemap.xml');
const feedPath = path.join(ROOT, 'rss.xml');
const shouldWrite = process.argv.includes('--write');
const current = fs.existsSync(sitemapPath) ? fs.readFileSync(sitemapPath, 'utf8') : '';
const currentFeed = fs.existsSync(feedPath) ? fs.readFileSync(feedPath, 'utf8') : '';

if (shouldWrite) {
  fs.writeFileSync(sitemapPath, expected);
  fs.writeFileSync(feedPath, expectedFeed);
  console.log(`Generated sitemap.xml and rss.xml for ${routes.length} live routes.`);
} else if (current !== expected || currentFeed !== expectedFeed) {
  console.error('sitemap.xml or rss.xml is stale. Run npm run routes:generate.');
  process.exitCode = 1;
} else {
  console.log(`sitemap.xml and rss.xml match ${routes.length} live routes.`);
}
