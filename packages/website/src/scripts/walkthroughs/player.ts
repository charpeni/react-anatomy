import type { Walkthrough } from './steps.ts';
import { waitFor } from './steps.ts';

function setStepText(element: Element, text: string) {
  const parts = text.split(/`([^`]+)`/);
  element.replaceChildren(
    ...parts.map((part, index) => {
      if (index % 2 === 0) {
        return part;
      }
      const code = document.createElement('code');
      code.textContent = part;
      return code;
    }),
  );
}

export function mountWalkthrough(root: HTMLElement, guide: Walkthrough) {
  const start = root.querySelector<HTMLButtonElement>('.start-guide')!;
  const preview = root.querySelector<HTMLElement>('.guide-preview')!;
  const player = root.querySelector<HTMLElement>('.guide-player')!;
  const next = root.querySelector<HTMLButtonElement>('.guide-next')!;
  const back = root.querySelector<HTMLButtonElement>('.guide-back')!;
  const instruction = root.querySelector<HTMLElement>('.guide-instruction')!;
  const browser = root.querySelector<HTMLElement>('.guide-browser')!;
  let frames: { source: HTMLIFrameElement; panel: HTMLIFrameElement } | undefined;
  let index = 0;
  let failed = false;
  let busy = false;

  function show(view: 'page' | 'anatomy') {
    if (!frames) {
      return;
    }
    const page = view === 'page';
    frames.source.classList.toggle('demo-frame-inactive', !page);
    frames.source.inert = !page;
    frames.source.setAttribute('aria-hidden', String(!page));
    frames.panel.hidden = page;
    frames.panel.inert = page;
    browser
      .querySelectorAll<HTMLButtonElement>('[data-view]')
      .forEach((tab) => tab.setAttribute('aria-pressed', String(tab.dataset.view === view)));
  }

  async function prepare() {
    browser.replaceChildren(root.querySelector('template')!.content.cloneNode(true));
    const source = browser.querySelector<HTMLIFrameElement>('#anatomy-source')!;
    const panel = browser.querySelector<HTMLIFrameElement>('#anatomy-panel')!;
    frames = { source, panel };
    source.src = guide.source;
    await waitFor(
      () =>
        source.contentWindow?.anatomyExample &&
        source.contentDocument?.querySelector(guide.readySelector),
    );
    panel.src = '/interactive/panel.html';
    await waitFor(() => panel.contentDocument?.querySelector('.tree-select'));
    const panelDoc = panel.contentDocument!;
    panelDoc.documentElement.setAttribute('data-guide-panel', '');
    panelDoc.addEventListener('click', (event) => {
      const action = panelDoc.querySelector('button[data-guide-target="advance"]');
      if (action?.contains(event.target as Node)) {
        void render(index + 1);
      }
    });
    browser.querySelector<HTMLElement>('.demo-loading')!.hidden = true;
    browser.querySelector<HTMLButtonElement>('[data-view="anatomy"]')!.disabled = false;
  }

  async function render(target: number, restart = false) {
    if (busy) {
      return;
    }
    busy = true;
    preview.hidden = true;
    player.hidden = false;
    back.disabled = true;
    next.disabled = true;
    const [title, explanation] = guide.steps[target];
    root.querySelector('.guide-count')!.textContent = `Step ${target + 1} of ${guide.steps.length}`;
    setStepText(root.querySelector('.guide-title')!, title);
    instruction.textContent = 'Opening the example…';
    try {
      if (!frames || restart) {
        await prepare();
      }
      show('anatomy');
      const panel = frames!.panel.contentDocument!;
      const source = frames!.source.contentDocument!;
      for (const doc of [panel, source]) {
        doc.querySelector('[data-guide-target]')?.removeAttribute('data-guide-target');
      }
      await guide.run(target, panel, source);
      index = target;
      failed = false;
      setStepText(instruction, explanation);
      back.disabled = index === 0;
    } catch {
      failed = true;
      instruction.textContent =
        'This step could not be completed. Restart the walkthrough to restore the sample.';
    } finally {
      const showRestart = failed || index === guide.steps.length - 1;
      next.toggleAttribute('data-restart', showRestart);
      next.textContent = showRestart ? 'Restart' : 'Next step';
      next.disabled = false;
      busy = false;
    }
  }

  // Keyboard activation keeps focus in the controls while the inspector selects
  // or highlights its target. A reader using the pointer can explore either tab.
  async function navigate(event: MouseEvent, target: number, restart = false) {
    const button = event.currentTarget as HTMLButtonElement;
    await render(target, restart);
    if (
      event.detail === 0 &&
      root.isConnected &&
      (!document.activeElement ||
        document.activeElement === document.body ||
        browser.contains(document.activeElement))
    ) {
      (button.disabled || button === start ? next : button).focus({ preventScroll: true });
    }
  }

  start.addEventListener('click', (event) => void navigate(event, 0));
  back.addEventListener('click', (event) => void navigate(event, index - 1));
  next.addEventListener('click', (event) => {
    const restart = failed || index === guide.steps.length - 1;
    void navigate(event, restart ? 0 : index + 1, restart);
  });
  browser.addEventListener('click', (event) => {
    const tab = (event.target as Element).closest<HTMLButtonElement>('[data-view]');
    if (tab && !busy) {
      show(tab.dataset.view === 'page' ? 'page' : 'anatomy');
    }
  });
  for (const event of ['anatomy-example-highlight', 'anatomy-example-pick']) {
    window.addEventListener(event, () => show('page'));
  }
  for (const event of ['anatomy-example-picked', 'anatomy-example-cancel-pick']) {
    window.addEventListener(event, () => show('anatomy'));
  }
  root.hidden = false;
}
