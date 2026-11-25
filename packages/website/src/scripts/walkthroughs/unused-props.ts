import type { Walkthrough } from './steps.ts';
import { emphasize, selectComponent, waitFor } from './steps.ts';

const filename = 'billing-analysis.json';

async function openSampleAudit(doc: Document) {
  await selectComponent(doc, 'PlanCard', 'team');
  const section = await waitFor(() => doc.querySelector<HTMLDetailsElement>('.unused-props'));
  if (!section.open) {
    section.querySelector('summary')!.click();
  }
  if (
    !Array.from(section.querySelectorAll('.unused-muted')).some(
      (el) => el.textContent === 'Analysis: ' + filename,
    )
  ) {
    const response = await fetch('/interactive/' + filename);
    if (!response.ok) {
      throw new Error('The billing sample analysis could not be loaded.');
    }
    // Use the inspector's regular file loader, with the report generated from this build.
    const input = section.querySelector<HTMLInputElement>('input[type="file"]')!;
    const transfer = new DataTransfer();
    transfer.items.add(new File([await response.blob()], filename, { type: 'application/json' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  await waitFor(() => section.querySelector('.unused-summary'));
  return section;
}

export const unusedProps: Walkthrough = {
  label: 'Billing plans',
  address: '/interactive/billing.html',
  source: '/interactive/billing.html',
  readySelector: '.plan-card',
  steps: [
    [
      'Inspect the Team plan',
      'The sample analysis is already loaded. Unused props lists the props the billing page passes to this `PlanCard`.',
    ],
    [
      'Investigate `legacyTheme`',
      'The billing page passes `legacyTheme`, but `PlanCard` and its children never read it. Check this call site for cleanup.',
    ],
    ['Compare `trackingId`', 'The click handler reads `trackingId` when someone chooses a plan.'],
  ],
  async run(step, doc) {
    const section = await openSampleAudit(doc);
    if (step === 0) {
      emphasize(section.querySelector<HTMLElement>('.unused-summary')!);
      return;
    }
    const prop = step === 1 ? 'legacyTheme' : 'trackingId';
    const row = await waitFor(() => section.querySelector<HTMLElement>(`[data-prop="${prop}"]`));
    const group = row.closest('details')!;
    if (!group.open) {
      group.querySelector('summary')!.click();
    }
    const header = row.querySelector<HTMLButtonElement>('.unused-row-head')!;
    if (header.getAttribute('aria-expanded') !== 'true') {
      header.click();
    }
    await waitFor(() => row.querySelector('.unused-evidence-list'));
    emphasize(header);
  },
};
