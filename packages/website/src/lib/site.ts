export const site = {
  name: 'React Anatomy',
  url: 'https://react-anatomy.com',
  title: 'React Anatomy — 3D React component inspector',
  description:
    'Explore React component trees in 3D and inspect live props. An open-source DevTools extension for Chrome and Firefox.',
  repository: 'https://github.com/charpeni/react-anatomy',
  author: { name: 'Nicolas Charpentier', url: 'https://github.com/charpeni' },
  socialImage: '/media/react-anatomy-social.png',
  socialImageAlt:
    'React Anatomy DevTools panel with a component tree, exploded 3D layout, and live props.',
} as const;

export function canonicalUrl(pathname: string) {
  const url = new URL(pathname, site.url);

  url.search = '';
  url.hash = '';

  return url.href;
}

export function structuredData(title: string, description: string, pathname: string) {
  const url = canonicalUrl(pathname);
  const home = canonicalUrl('/');
  const website = `${home}#website`;
  const software = `${home}#software`;
  const person = `${home}#author`;
  const isHome = pathname === '/';
  const isDoc = pathname.startsWith('/docs/');

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Person',
        '@id': person,
        name: site.author.name,
        url: site.author.url,
      },
      {
        '@type': 'WebSite',
        '@id': website,
        url: home,
        name: site.name,
        description: site.description,
        inLanguage: 'en',
        publisher: { '@id': person },
      },
      ...(isHome
        ? [
            {
              '@type': 'SoftwareApplication',
              '@id': software,
              name: site.name,
              url: home,
              description: site.description,
              applicationCategory: 'DeveloperApplication',
              applicationSubCategory: 'Browser extension',
              softwareRequirements:
                'Desktop Chrome 140+ or Firefox 140+; React DOM 18.2, 18.3, or 19.0–19.3.',
              license: `${site.repository}/blob/main/LICENSE`,
              sameAs: site.repository,
              creator: { '@id': person },
              image: canonicalUrl(site.socialImage),
              screenshot: canonicalUrl('/media/docs/hierarchy.png'),
              featureList: [
                'Inspect the rendered React component hierarchy',
                'Explore page composition as separated 3D layers',
                'Read live component props',
                'Pick a component on the page and focus its subtree',
              ],
            },
          ]
        : []),
      {
        '@type': isDoc ? 'TechArticle' : 'WebPage',
        '@id': `${url}#page`,
        url,
        name: title,
        ...(isDoc ? { headline: title } : {}),
        description,
        inLanguage: 'en',
        isPartOf: { '@id': website },
        ...(isHome ? { mainEntity: { '@id': software } } : {}),
        ...(isDoc ? { about: { '@id': software }, author: { '@id': person } } : {}),
      },
    ],
  };
}
