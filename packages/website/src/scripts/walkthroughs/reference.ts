import type { Walkthrough } from './steps.ts';
import { orbitUrl } from '../../lib/site.ts';
import { emphasize, selectComponent, waitFor } from './steps.ts';

export const reference: Walkthrough = {
  label: 'Orbit',
  address: orbitUrl,
  source: '/interactive/source.html',
  readySelector: '.project-card',
  steps: [
    [
      'Search from the Customer portal card',
      'In Props, click the highlighted link beside `onCompleteTask` to find the other components that received it.',
    ],
    [
      'Find the shared callback',
      '`MainContent`, `ProjectList`, and three `ProjectCard` instances hold the same function. Select any match to inspect that instance.',
    ],
    [
      'Locate the Mobile app card',
      'Highlight on page shows the `mobile-app` match in Orbit. Switch to Anatomy to inspect the selected card.',
    ],
  ],
  async run(step, doc, source) {
    await selectComponent(doc, 'ProjectCard', 'customer-portal');
    const search = await waitFor(() =>
      doc.querySelector<HTMLButtonElement>('[aria-label="Find same reference as onCompleteTask"]'),
    );
    if (step === 0) {
      doc.querySelector<HTMLButtonElement>('[aria-label="Close same reference"]')?.click();
      emphasize(search, 'advance');
      return;
    }
    const match = () => {
      const result = doc.querySelector('.same-reference');
      return (
        result?.querySelector('.reference-source')?.textContent?.includes('customer-portal') &&
        result.querySelector<HTMLButtonElement>('[aria-label*="ProjectCard key mobile-app"]')
      );
    };
    if (search.getAttribute('aria-pressed') !== 'true') {
      search.click();
    }
    const mobile = await waitFor(match);
    if (step === 1) {
      emphasize(doc.querySelector<HTMLElement>('.reference-summary')!);
      return;
    }
    mobile.click();
    await waitFor(
      () => doc.querySelector('.tree-row.selected .tree-key')?.textContent === 'key="mobile-app"',
    );
    const tile = source.querySelector<HTMLElement>('[data-project="mobile-app"]')!;
    const page = source.scrollingElement!;
    page.scrollTop += tile.getBoundingClientRect().top - page.clientHeight / 3;
    doc.querySelector<HTMLButtonElement>('[aria-label="Highlight on page"]')!.click();
    await waitFor(() => doc.defaultView?.frameElement?.hasAttribute('hidden'));
    emphasize(tile);
  },
};
