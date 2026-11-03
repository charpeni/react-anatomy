import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://react-anatomy.com',
  integrations: [
    starlight({
      title: 'React Anatomy',
      disable404Route: true,
      description:
        'Understand how a React page is composed: the running page and the components React rendered for it, connected inside DevTools.',
      logo: { src: '../../packages/brand/svg/mark-light.svg', replacesTitle: false },
      favicon: '/favicon.svg',
      head: [
        {
          tag: 'link',
          attrs: {
            rel: 'preload',
            href: '/fonts/instrument-sans/latin-wght-normal.woff2',
            as: 'font',
            type: 'font/woff2',
            crossorigin: '',
          },
        },
      ],
      customCss: ['./src/styles/docs.css'],
      components: { Footer: './src/components/DocsFooter.astro' },
      sidebar: [
        { label: 'Overview', slug: 'docs' },
        {
          label: 'Guides',
          items: [
            { label: 'Understand a page', slug: 'docs/understand' },
            { label: 'Explain a change', slug: 'docs/explain-a-change' },
            { label: 'Read generated code', slug: 'docs/generated-code' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Layers, focus, and controls', slug: 'docs/explore' },
            { label: 'Props inspector', slug: 'docs/props' },
            { label: 'Compatibility', slug: 'docs/compatibility' },
            { label: 'Current limitations', slug: 'docs/limitations' },
            { label: 'Local development', slug: 'docs/development' },
          ],
        },
      ],
      lastUpdated: false,
    }),
  ],
});
