import type { APIContext } from 'astro';
import { url } from '../lib/content';
export function GET(context: APIContext) {
  return new Response(
    `User-agent: *\nAllow: /\nSitemap: ${new URL(url('sitemap.xml'), context.site).href}\n`,
  );
}
