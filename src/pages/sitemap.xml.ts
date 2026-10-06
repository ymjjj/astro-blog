import type { APIContext } from 'astro';
import { published, entryUrl, tagsFor, tagUrl, url } from '../lib/content';
import { pageCount, pagePath } from '../lib/pagination';
const escape = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
export async function GET(context: APIContext) {
  const { all, posts, moments } = await published();
  const paths = ['', 'posts/', 'moments/', 'tags/', 'archives/', 'about/'].map(url).concat(
    all.map(entryUrl),
    tagsFor(all).map(([tag]) => tagUrl(tag)),
    ...(
      [
        ['', all.length],
        ['posts', posts.length],
        ['moments', moments.length],
      ] as const
    ).map(([section, count]) =>
      Array.from({ length: pageCount(count) - 1 }, (_, i) => url(pagePath(section, i + 2))),
    ),
  );
  const body =
    '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    paths
      .map((path) => {
        const entry = all.find((entry) => entryUrl(entry) === path);
        const modified = entry?.collection === 'posts' ? entry.data.updated : undefined;
        return `<url><loc>${escape(new URL(path, context.site).href)}</loc>${modified ? `<lastmod>${modified.toISOString()}</lastmod>` : ''}</url>`;
      })
      .join('') +
    '</urlset>';
  return new Response(body, { headers: { 'Content-Type': 'application/xml' } });
}
