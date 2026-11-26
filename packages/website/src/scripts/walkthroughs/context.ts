import type { Walkthrough } from './steps.ts';
import { emphasize, selectComponent, waitFor } from './steps.ts';

export const context: Walkthrough = {
  label: 'Context providers',
  address: '/interactive/context.html',
  source: '/interactive/context.html',
  readySelector: '#toggle-theme',
  steps: [
    [
      'Find the theme readers',
      '`ThemedHeading`, `ThemedBadge`, and `ThemedToast` subscribe to this `ThemeContext` provider.',
    ],
    [
      'Follow the toast',
      'Select `ThemedToast` in the results. The toast appears in a portal and still reads the theme from its parent in the React tree.',
    ],
    [
      'Inspect the outer accent provider',
      'Switch the provider menu to the outer `AccentContext`. Five components read its value.',
    ],
    [
      'Switch to the nested provider',
      'The nested `AccentContext` supplies `InnerAccent`. The nearest provider determines which value the component reads.',
    ],
  ],
  async run(step, doc) {
    await selectComponent(doc, 'ThemedHeading');
    const section = await waitFor(() => doc.querySelector<HTMLDetailsElement>('.context-readers'));
    if (!section.open) {
      section.querySelector('summary')!.click();
    }
    const menu = await waitFor(() =>
      section.querySelector<HTMLSelectElement>('[aria-label="Context provider"]'),
    );
    const provider =
      step < 2
        ? 'ThemeContext · in ThemeBoundary'
        : step === 2
          ? 'AccentContext #1 · in EdgeCases'
          : '↳ AccentContext #1 · in EdgeCases';
    const option = await waitFor(() =>
      Array.from(menu.options).find((item) => item.text.startsWith(provider)),
    );
    if (!option.selected) {
      menu.value = option.value;
      menu.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const expected = step < 2 ? 'ThemedToast' : step === 2 ? 'OuterAccent' : 'InnerAccent';
    const row = await waitFor(() =>
      Array.from(
        section.querySelectorAll<HTMLButtonElement>(
          '[aria-labelledby="context-readers-heading"] .context-row',
        ),
      ).find((item) => item.querySelector('.context-row-name')?.textContent === expected),
    );
    if (step === 1) {
      row.click();
      await waitFor(
        () => doc.querySelector('.tree-row.selected .node-name')?.textContent === 'ThemedToast',
      );
    }
    emphasize(step === 1 ? row : section.querySelector<HTMLElement>('#context-readers-heading')!);
  },
};
