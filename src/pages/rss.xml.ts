import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { site } from '../site.config';
import { published, entryUrl, entryTitle, excerpt } from '../lib/content';
export async function GET(context: APIContext) {
  const { all } = await published();
  return rss({
    title: site.title,
    description: site.description,
    site: context.site!,
    items: all.map((entry) => ({
      title: entryTitle(entry),
      pubDate: entry.data.date,
      description: excerpt(entry),
      link: entryUrl(entry),
      categories: entry.data.tags,
    })),
    customData: '<language>zh-cn</language>',
  });
}
