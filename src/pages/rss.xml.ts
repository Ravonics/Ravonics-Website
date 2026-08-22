import rss from '@astrojs/rss';
import { getInsightPages } from '../lib/site-pages';

export async function GET(context: { site: URL }) {
  const items = getInsightPages().map((page) => ({
    title: page.title,
    description: page.description,
    link: page.route
  }));

  return rss({
    title: 'Ravonics Insights',
    description:
      'Technical perspectives on federal AI, autonomy, cryptography, cloud, and systems engineering.',
    site: context.site ?? 'https://ravonics.com',
    items,
    customData: '<language>en-us</language>'
  });
}
