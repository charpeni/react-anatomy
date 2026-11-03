import { canonicalUrl } from '../lib/site.ts';

export function GET() {
  return new Response(
    `User-agent: *\nAllow: /\n\nSitemap: ${canonicalUrl('/sitemap-index.xml')}\n`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
}
