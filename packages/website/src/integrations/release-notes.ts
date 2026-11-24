import type { AstroIntegration } from 'astro';
import { z } from 'astro/zod';
import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import { site } from '../lib/site.ts';

const repositoryPath = new URL(site.repository).pathname;
const releasesApi = `https://api.github.com/repos${repositoryPath}/releases?per_page=100`;
const releaseSchema = z.object({
  id: z.number(),
  tag_name: z.string().min(1),
  published_at: z.iso.datetime().nullable(),
  html_url: z.url(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  body: z.string().nullish(),
});
type Release = z.infer<typeof releaseSchema>;
type PublishedRelease = Release & { published_at: string };
const markdown = unified().use(remarkParse).use(remarkGfm).use(remarkStringify, { bullet: '-' });
const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' });

function releaseLink(url: string, release: Release, image: boolean) {
  if (url.startsWith('#')) {
    return new URL(url, release.html_url).href;
  }
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url)) {
    const absolute = new URL(url, site.repository);
    return ['https:', 'http:', 'mailto:', 'tel:'].includes(absolute.protocol) ? absolute.href : '#';
  }
  const file = new URL(url, 'https://github.com/');
  const tag = encodeURIComponent(release.tag_name);
  const base = image
    ? `https://raw.githubusercontent.com${repositoryPath}/${tag}`
    : `${site.repository}/blob/${tag}`;
  return base + file.pathname + file.search + file.hash;
}

function releaseSection(release: PublishedRelease) {
  const body = markdown.parse(release.body ?? '');
  const imageDefinitions = new Set<string>();
  visit(body, 'imageReference', (node) => {
    imageDefinitions.add(node.identifier);
  });

  // Each release is a standalone document on GitHub. Keep its headings and
  // reference definitions scoped when several documents share the same page.
  visit(body, (node, index, parent) => {
    if (node.type === 'heading') {
      node.depth = Math.min(6, node.depth + 2) as typeof node.depth;
    }
    if (node.type === 'image' || node.type === 'link' || node.type === 'definition') {
      const image =
        node.type === 'image' ||
        (node.type === 'definition' && imageDefinitions.has(node.identifier));
      node.url = releaseLink(node.url, release, image);
    }
    if ('identifier' in node) {
      node.identifier = `${release.id}-${node.identifier}`;
      node.label = `${release.id}-${node.label ?? ''}`;
    }
    if (node.type === 'html' && parent && index !== undefined) {
      const text = { type: 'text' as const, value: node.value };
      // These containers hold blocks. A bare text child makes the Markdown
      // serializer run the surrounding headings and paragraphs together.
      switch (parent.type) {
        case 'root':
        case 'blockquote':
        case 'listItem':
        case 'footnoteDefinition':
          parent.children[index] = { type: 'paragraph', children: [text] };
          break;
        default:
          parent.children[index] = text;
      }
    }
  });

  const meta =
    dateFormat.format(new Date(release.published_at)) +
    (release.prerelease ? ' · Pre-release' : '');
  body.children.unshift(
    { type: 'heading', depth: 2, children: [{ type: 'text', value: release.tag_name }] },
    {
      type: 'paragraph',
      children: [
        { type: 'text', value: meta + ' · ' },
        {
          type: 'link',
          url: release.html_url,
          children: [{ type: 'text', value: 'View on GitHub' }],
        },
      ],
    },
  );
  return markdown.stringify(body).trimEnd();
}

export async function fetchReleaseNotes(request: typeof fetch = fetch) {
  const releases: Release[] = [];
  let page: string | undefined = releasesApi;
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  while (page) {
    if (new URL(page).origin !== 'https://api.github.com') {
      throw new Error('Unexpected GitHub Releases pagination URL.');
    }
    const response: Response = await request(page, { headers, signal: AbortSignal.timeout(15000) });
    if (!response.ok) {
      throw new Error(`GitHub Releases returned HTTP ${response.status}.`);
    }
    releases.push(...releaseSchema.array().parse(await response.json()));
    page = response.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
  }
  const sections = releases
    .filter(
      (release): release is PublishedRelease => !release.draft && release.published_at !== null,
    )
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
    .map(releaseSection);

  return [
    '---',
    'title: Release Notes',
    'description: Changes in published versions of the React Anatomy browser extension.',
    '---',
    '',
    sections.join('\n\n') || 'No releases have been published yet.',
    '',
  ].join('\n');
}

export function releaseNotes(): AstroIntegration {
  return {
    name: 'react-anatomy-release-notes',
    hooks: {
      'astro:config:setup': async ({ command, config, logger }) => {
        if (command === 'preview') {
          return;
        }
        const file = new URL('content/docs/docs/release-notes.md', config.srcDir);
        const previous = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') {
            return undefined;
          }
          throw error;
        });
        let notes: string;
        try {
          notes = await fetchReleaseNotes();
        } catch (error) {
          if (command === 'build' || !previous) {
            throw error;
          }
          logger.warn(`Using the last generated Release Notes. ${error}`);
          return;
        }
        if (notes !== previous) {
          const temporary = new URL(`.${randomUUID()}.tmp`, file);
          try {
            await writeFile(temporary, notes);
            await rename(temporary, file);
          } finally {
            await rm(temporary, { force: true });
          }
        }
      },
    },
  };
}
