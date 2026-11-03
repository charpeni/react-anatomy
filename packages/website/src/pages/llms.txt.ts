import { getCollection } from 'astro:content';
import { documentPath } from '../lib/documentation.ts';
import { canonicalUrl, site } from '../lib/site.ts';

export async function GET() {
  const entries = (await getCollection('docs')).sort((a, b) => a.id.localeCompare(b.id));
  const links = entries.map((entry) => {
    return `- [${entry.data.title}](${canonicalUrl(`/${documentPath(entry)}.md`)}): ${entry.data.description ?? ''}`;
  });

  return new Response(
    [
      `# ${site.name}`,
      `> ${site.description}`,
      'React Anatomy inspects the rendered React component tree, visible page layers, and live props. It does not show an import graph or server-only components. Inspection runs locally in the browser.',
      'The Markdown documents below are generated from the same sources as the website. Each includes the URL of its HTML page for citation.',
      '## Website and source',
      `- [Website and interactive example](${canonicalUrl('/')})`,
      `- [Source code](${site.repository})`,
      `- [MIT license](${site.repository}/blob/main/LICENSE)`,
      '## Documentation',
      links.join('\n'),
      '',
    ].join('\n\n'),
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
}
