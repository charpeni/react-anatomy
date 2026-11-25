export interface Walkthrough {
  label: string;
  address: string;
  source: string;
  readySelector: string;
  steps: readonly (readonly [string, string])[];
  run: (step: number, panel: Document, source: Document) => Promise<void>;
}

export async function waitFor<T>(read: () => T | null | undefined | false): Promise<T> {
  const deadline = performance.now() + 12000;
  while (performance.now() < deadline) {
    const value = read();
    if (value) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error('Restart the walkthrough to restore the sample.');
}

export async function selectComponent(doc: Document, name: string, key?: string) {
  const row = await waitFor(() =>
    Array.from(doc.querySelectorAll<HTMLButtonElement>('.tree-select')).find(
      (el) =>
        el.querySelector('.node-name')?.textContent === name &&
        (!key || el.querySelector('.tree-key')?.textContent === `key="${key}"`),
    ),
  );
  row.click();
  await waitFor(() => row.closest('.tree-row')?.classList.contains('selected'));
}

export function emphasize(element: HTMLElement, action: 'advance' | '' = '') {
  const pane = element.closest('.inspector-scroll');
  if (pane) {
    pane.scrollTop +=
      element.getBoundingClientRect().top -
      pane.getBoundingClientRect().top -
      pane.clientHeight / 3;
  }
  element.setAttribute('data-guide-target', action);
}
