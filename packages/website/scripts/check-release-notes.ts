import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchReleaseNotes } from '../src/integrations/release-notes.ts';

const repo = 'https://github.com/charpeni/react-anatomy';
const release = {
  id: 1,
  tag_name: 'v1',
  html_url: `${repo}/releases/tag/v1`,
  published_at: '2026-11-01T00:00:00Z',
  draft: false,
  prerelease: false,
  body: null,
};

test('collects all public releases and preserves Markdown in the combined document', async () => {
  const next = 'https://api.github.com/repositories/123/releases?page=2';
  const urls: string[] = [];
  const notes = await fetchReleaseNotes(async (url) => {
    urls.push(String(url));
    if (urls.length === 1) {
      return Response.json([release, { ...release, draft: true, tag_name: 'hidden' }], {
        headers: { link: `<${next}>; rel="next"` },
      });
    }
    return Response.json([
      {
        ...release,
        id: 2,
        tag_name: 'v2-beta',
        html_url: `${repo}/releases/tag/v2-beta`,
        published_at: '2026-11-12T18:30:00Z',
        prerelease: true,
        body: '# Changes\n\n- [Guide](docs/guide.md)\n- ![UI](ui.png)\n\n```md\n# Literal\n```',
      },
    ]);
  });

  assert.deepEqual(urls, [
    'https://api.github.com/repos/charpeni/react-anatomy/releases?per_page=100',
    next,
  ]);
  assert.deepEqual(
    [...notes.matchAll(/^## (.+)$/gm)].map((match) => match[1]),
    ['v2-beta', 'v1'],
  );
  assert.match(notes, /November 12, 2026 · Pre-release/);
  assert(notes.includes(`[View on GitHub](${repo}/releases/tag/v2-beta)`));
  assert(notes.includes('### Changes'));
  assert(notes.includes(`[Guide](${repo}/blob/v2-beta/docs/guide.md)`));
  assert(
    notes.includes(
      '![UI](https://raw.githubusercontent.com/charpeni/react-anatomy/v2-beta/ui.png)',
    ),
  );
  assert(notes.includes('```md\n# Literal\n```'));
});

test('distinguishes an empty release history from an incomplete fetch', async () => {
  assert.match(
    await fetchReleaseNotes(async () => Response.json([])),
    /No releases have been published yet/,
  );
  const next = 'https://api.github.com/repositories/123/releases?page=2';
  await assert.rejects(
    fetchReleaseNotes(async (url) =>
      String(url) === next
        ? new Response(null, { status: 503 })
        : Response.json([release], { headers: { link: `<${next}>; rel="next"` } }),
    ),
    /HTTP 503/,
  );
});
