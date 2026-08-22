import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

// Astro evaluates this module during the build, where process.cwd() is the
// project root. Keeping the source root independent of the bundled chunk
// location makes the legacy-page bridge work in both dev and static builds.
const ROOT = process.cwd();

export const PageKind = z.enum([
  'home',
  'capability',
  'solution',
  'industry',
  'company',
  'insight',
  'conversion',
  'legal'
]);

export const PageMetadataSchema = z.object({
  route: z.string().regex(/^\/(?:[^?#]*)$/),
  source: z.string().min(1),
  kind: PageKind,
  title: z.string().min(1),
  description: z.string(),
  canonical: z.url(),
  hasJsonLd: z.boolean(),
  hasMain: z.boolean(),
  hasArticle: z.boolean(),
  sourceImage: z.string().nullable()
});

export type PageMetadata = z.infer<typeof PageMetadataSchema>;

const ROOT_PAGES = new Set(['index.html', 'contact.html', 'booking.html', 'privacy.html', 'terms.html']);
const LIVE_DIRECTORIES = ['capabilities', 'solutions', 'industries', 'company', 'insights'];

function htmlFilesIn(directory: string, includeRoot: boolean): string[] {
  const absolute = path.join(ROOT, directory);
  if (!fs.existsSync(absolute)) return [];
  return fs
    .readdirSync(absolute, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .filter((entry) => !includeRoot || ROOT_PAGES.has(entry.name))
    .map((entry) => path.join(directory, entry.name));
}

function extract(html: string, expression: RegExp): string {
  return html.match(expression)?.[1]?.trim() ?? '';
}

function kindFor(relative: string): PageMetadata['kind'] {
  if (relative === 'index.html') return 'home';
  if (relative === 'contact.html' || relative === 'booking.html') return 'conversion';
  if (relative === 'privacy.html' || relative === 'terms.html') return 'legal';
  const directory = relative.split('/')[0];
  if (directory === 'capabilities') return 'capability';
  if (directory === 'solutions') return 'solution';
  if (directory === 'industries') return 'industry';
  if (directory === 'company') return 'company';
  return 'insight';
}

function routeFor(relative: string): string {
  return relative === 'index.html' ? '/' : `/${relative}`;
}

export function getLivePages(): PageMetadata[] {
  const files = [
    ...htmlFilesIn('', true),
    ...LIVE_DIRECTORIES.flatMap((directory) => htmlFilesIn(directory, false))
  ].sort();

  return files.map((relative) => {
    const source = path.join(ROOT, relative);
    const html = fs.readFileSync(source, 'utf8');
    return PageMetadataSchema.parse({
      route: routeFor(relative),
      source,
      kind: kindFor(relative),
      title: extract(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
      description:
        extract(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ||
        extract(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i),
      canonical: extract(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i),
      hasJsonLd: /<script[^>]+type=["']application\/ld\+json["']/i.test(html),
      hasMain: /<main\b/i.test(html),
      hasArticle: /<article\b/i.test(html),
      sourceImage:
        html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)["']/i)?.[1] ?? null
    });
  });
}

export function getInsightPages(): PageMetadata[] {
  return getLivePages().filter((page) => page.kind === 'insight');
}

export function getProjectRoot(): string {
  return ROOT;
}
