import type { CollectionEntry } from 'astro:content';
import { canonicalUrl } from './site.ts';

export function documentPath(entry: CollectionEntry<'docs'>) {
  return entry.id.replace(/(?:^|\/)index$/, '').replace(/\/$/, '');
}

export function documentMarkdown(entry: CollectionEntry<'docs'>) {
  const url = canonicalUrl(`/${documentPath(entry)}/`);
  // Absolute links retain their destinations when a reader copies the text out of the website.
  const body = (entry.body ?? '')
    .replace(/\]\((\/[^)]*)\)/g, (_, path: string) => `](${new URL(path, url).href})`)
    .replace(
      /\b(href|src|poster)="(\/[^"]*)"/g,
      (_, attr: string, path: string) => `${attr}="${new URL(path, url).href}"`,
    );

  return `# ${entry.data.title}\n\nSource: ${url}\n\n${entry.data.description ?? ''}\n\n${body.trim()}\n`;
}
