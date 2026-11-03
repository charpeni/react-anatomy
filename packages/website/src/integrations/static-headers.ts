import type { AstroIntegration } from 'astro';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { site } from '../lib/site.ts';

// Prerendered endpoint Response headers are not preserved by a static host.
// Write Cloudflare's header rules from the documents actually emitted by Astro.
export function staticHeaders(): AstroIntegration {
  return {
    name: 'react-anatomy-static-headers',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        const rules = [
          '/interactive/*\n  X-Robots-Tag: noindex',
          '/llms.txt\n  Content-Type: text/plain; charset=utf-8\n  X-Robots-Tag: noindex',
        ];
        const paths = (await readdir(dir, { recursive: true }))
          .filter((path) => path.endsWith('.md'))
          .sort();

        for (const path of paths) {
          const markdown = await readFile(new URL(path, dir), 'utf8');
          const canonical = /^Source: (https:\/\/[^\s]+)$/m.exec(markdown)?.[1];

          if (!canonical || new URL(canonical).origin !== site.url) {
            continue;
          }

          rules.push(
            `/${path}\n  Content-Type: text/markdown; charset=utf-8\n  X-Robots-Tag: noindex\n  Link: <${canonical}>; rel="canonical"`,
          );
        }

        await writeFile(new URL('_headers', dir), rules.join('\n\n') + '\n');
      },
    },
  };
}
