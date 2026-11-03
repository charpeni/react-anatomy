import { mountDemoIntroduction } from './demo-introduction.ts';

type SampleWindow = Window & {
  anatomyExample?: { call: (request: { action: string }) => unknown };
};

export function mountExample(root: HTMLElement) {
  const source = root.querySelector<HTMLIFrameElement>('#anatomy-source')!;
  const panel = root.querySelector<HTMLIFrameElement>('#anatomy-panel')!;
  const hint = root.querySelector<HTMLElement>('.demo-hint')!;
  const loading = root.querySelector<HTMLElement>('.demo-loading')!;
  const restart = root.querySelector<HTMLButtonElement>('.demo-reset')!;
  let ready: Promise<Document> | undefined;
  let panelLoaded = false;
  let panelOpened = false;
  let loadingExit: Animation | undefined;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const easeOut = getComputedStyle(root).getPropertyValue('--ease-out').trim();
  let generation = 0;
  let action = 0;
  let picking = false;
  let step = 'page';
  let error = false;
  let motionTimer: ReturnType<typeof setTimeout>;
  const scrollDocuments = new WeakSet<Document>();
  let introduction: ReturnType<typeof mountDemoIntroduction> | undefined;

  function cancelLoadingExit() {
    loadingExit?.cancel();
    loadingExit = undefined;
    delete loading.dataset.dismissing;
    loading.removeAttribute('aria-hidden');
  }

  function showLoading(message: string) {
    cancelLoadingExit();
    loading.hidden = false;
    loading.textContent = message;
  }

  function hideLoading(animate = false) {
    // Repeated pointer actions may reuse the exit already in progress. Keyboard
    // actions and resets cancel it immediately instead of waiting for the fade.
    if (animate && loadingExit) {
      return;
    }

    cancelLoadingExit();

    if (loading.hidden) {
      return;
    }

    if (!animate) {
      loading.hidden = true;

      return;
    }

    loading.dataset.dismissing = '';
    loading.setAttribute('aria-hidden', 'true');

    const exit = loading.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: reducedMotion.matches ? 80 : 140,
      easing: easeOut,
      fill: 'forwards',
    });

    loadingExit = exit;
    exit.onfinish = () => {
      if (loadingExit !== exit) {
        return;
      }

      loading.hidden = true;
      cancelLoadingExit();
    };
  }

  function forwardScroll(frame: HTMLIFrameElement) {
    const doc = frame.contentDocument;

    if (!doc || scrollDocuments.has(doc)) {
      return;
    }

    scrollDocuments.add(doc);
    let touch: { x: number; y: number } | undefined;

    doc.addEventListener(
      'touchstart',
      (event) => {
        const point = event.touches.length === 1 ? event.touches[0] : undefined;
        touch = point ? { x: point.clientX, y: point.clientY } : undefined;
      },
      { passive: true },
    );
    doc.addEventListener(
      'touchmove',
      (event) => {
        const point = event.touches.length === 1 ? event.touches[0] : undefined;
        if (!touch || !point) {
          touch = undefined;
          return;
        }
        const dx = touch.x - point.clientX;
        const dy = touch.y - point.clientY;
        if (Math.abs(dy) <= Math.abs(dx)) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        touch = { x: point.clientX, y: point.clientY };
        if (!introduction?.holdingScroll) {
          window.scrollBy({ top: dy, behavior: 'instant' });
        }
      },
      { capture: true, passive: false },
    );
    for (const type of ['touchend', 'touchcancel']) {
      doc.addEventListener(
        type,
        () => {
          touch = undefined;
        },
        { passive: true },
      );
    }

    doc.addEventListener(
      'wheel',
      (event) => {
        // The example is part of the page: catch wheel events before the panel's
        // React handlers, and bypass scrollable regions inside either iframe.
        event.stopPropagation();

        // Preserve the browser's own pinch/keyboard-modified zoom behaviour.
        if (event.ctrlKey || event.metaKey) {
          return;
        }

        event.preventDefault();

        if (introduction?.holdingScroll) {
          if (event.deltaY < 0) {
            introduction.cancel();
          } else {
            return;
          }
        }

        const unit =
          event.deltaMode === WheelEvent.DOM_DELTA_LINE
            ? 16
            : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
              ? window.innerHeight
              : 1;

        window.scrollBy({
          left: event.deltaX * unit,
          top: event.deltaY * unit,
          behavior: 'instant',
        });
      },
      { capture: true, passive: false },
    );
  }

  for (const frame of [source, panel]) {
    frame.addEventListener('load', () => forwardScroll(frame));
    forwardScroll(frame);
  }

  async function until<T>(
    read: () => T | null | undefined | false,
    version = generation,
  ): Promise<T> {
    const deadline = performance.now() + 12000;

    while (version === generation) {
      const value = read();

      if (value) {
        return value;
      }

      if (performance.now() > deadline) {
        throw new Error('The example could not load. Use Restart to try again.');
      }

      await new Promise((resolve) => setTimeout(resolve, 40));
    }

    throw new Error('Example restarted.');
  }

  function setView(view: 'page' | 'anatomy', currentStep = step) {
    step = currentStep;
    // visibility preserves the source document's viewport for capture.
    source.classList.toggle('demo-frame-inactive', view !== 'page');
    source.inert = view !== 'page';
    source.setAttribute('aria-hidden', String(view !== 'page'));
    panel.hidden = view !== 'anatomy';
    root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.view === view));
    });
    root.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.step === currentStep));
    });
  }

  function setMotion(doc: Document, keyboard: boolean) {
    clearTimeout(motionTimer);
    doc.documentElement.dataset.exampleMotion = keyboard ? 'instant' : 'explain';
    motionTimer = setTimeout(() => delete doc.documentElement.dataset.exampleMotion, 800);
  }

  function panelReady(): Promise<Document> {
    if (ready) {
      return ready;
    }

    const version = generation;

    ready = (async () => {
      await until(
        () =>
          (source.contentWindow as SampleWindow)?.anatomyExample &&
          source.contentDocument?.querySelector('.project-card'),
        version,
      );
      panel.src = '/interactive/panel.html';

      const doc = await until(
        () => panel.contentDocument?.querySelector('.tree-select') && panel.contentDocument,
        version,
      );

      if (root.querySelector<HTMLElement>('.demo-viewport')!.clientWidth < 700) {
        doc.querySelector<HTMLButtonElement>('[aria-label="Toggle component tree"]')?.click();
      }

      const help = doc.querySelector<HTMLElement>('.stage-help');

      if (help) {
        help.textContent = 'Drag to rotate · Use + / − to zoom · Double-click to focus';
      }

      panelLoaded = true;

      return doc;
    })();

    return ready;
  }

  async function choose(next: string, keyboard: boolean) {
    const request = ++action;
    const version = generation;
    const returningToPanel = panel.hidden && panelOpened;

    try {
      if (next === 'page') {
        if (picking) {
          (source.contentWindow as SampleWindow)?.anatomyExample?.call({ action: 'clear' });
        }

        picking = false;
        setView('page', 'page');
        hideLoading();
        hint.textContent = 'Change a project, then open Anatomy to inspect the result.';

        return;
      }

      root.dataset.guide = 'done';
      setView('anatomy', next);
      panelOpened = true;

      // A step within the ready panel needs no loading surface or new reveal.
      if (!panelLoaded || returningToPanel) {
        showLoading('Reading the sample’s React components…');
      }

      const doc = await panelReady();

      if (request !== action || version !== generation) {
        return;
      }

      if (returningToPanel) {
        const count = doc.querySelector('.footer-count')?.textContent;

        doc.querySelector<HTMLButtonElement>('[aria-label="Capture"]')?.click();
        await until(() => doc.querySelector('.footer-count')?.textContent !== count, version);

        if (request !== action || version !== generation) {
          return;
        }
      }

      hideLoading(!keyboard);
      setMotion(doc, keyboard);

      if (next === 'explode') {
        doc.querySelector<HTMLButtonElement>('.focus-navigation button')?.click();

        const details = doc.querySelector<HTMLButtonElement>(
          '[aria-label="Toggle component details"]',
        );

        if (details?.getAttribute('aria-pressed') === 'true') {
          details.click();
        }
      }

      const separated = doc.querySelector<HTMLInputElement>('[aria-label="Layer separation"]');

      if (separated && Number(separated.value) === 0) {
        // Give the flat scene one painted frame before it separates.
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        if (request !== action) {
          return;
        }

        doc.querySelector<HTMLButtonElement>('[aria-label="Explode view"]')?.click();
      }

      if (next === 'props') {
        const card = Array.from(doc.querySelectorAll<HTMLButtonElement>('.tree-select')).find(
          (button) => button.querySelector('.node-name')?.textContent === 'ProjectCard',
        );

        card?.click();

        // Selection already opens the real inspector on narrow screens. Do not
        // toggle it again before React commits that state update.
        const project = await until(
          () => doc.querySelector<HTMLDetailsElement>('[data-prop-path="props.project"]'),
          version,
        );

        if (request !== action) {
          return;
        }

        if (!project.open) {
          project.querySelector<HTMLElement>('summary')?.click();
        }

        hint.textContent = 'These are live props. Expand a value, or focus the selected subtree.';
      } else {
        hint.textContent = 'Drag to rotate. Select a layer or a component in the tree.';
      }
    } catch (cause) {
      if (request !== action || version !== generation) {
        return;
      }

      error = true;
      showLoading(cause instanceof Error ? cause.message : 'Use Restart to reload the example.');
      restart.disabled = false;
    }
  }

  introduction = mountDemoIntroduction({
    root,
    prepare: panelReady,
    open: (instant) => choose('explode', instant),
    cancelOpen: () => {
      action++;
      hideLoading();
    },
  });

  root
    .querySelectorAll<HTMLButtonElement>('[data-step], [data-view], [data-open-anatomy]')
    .forEach((button) => {
      button.addEventListener('click', (event) => {
        introduction?.cancel();
        const next = button.dataset.step || (button.dataset.view === 'page' ? 'page' : 'explode');

        void choose(next, event.detail === 0);
      });
    });
  document
    .querySelector<HTMLAnchorElement>('[data-open-example]')
    ?.addEventListener('click', (event) => {
      introduction?.cancel();
      void choose('explode', event.detail === 0);
    });

  const enable = async () => {
    const version = generation;

    try {
      await until(
        () =>
          (source.contentWindow as SampleWindow)?.anatomyExample &&
          source.contentDocument?.querySelector('.project-card'),
        version,
      );

      if (version !== generation) {
        return;
      }

      hideLoading();
      root
        .querySelectorAll<HTMLButtonElement>('button')
        .forEach((button) => (button.disabled = false));
    } catch {
      if (version !== generation) {
        return;
      }

      showLoading('The example could not load. Use Restart to try again.');
      restart.disabled = false;
    }
  };

  // Start waiting when the native lazy iframe actually loads, not while offscreen.
  source.addEventListener('load', () => {
    void enable();
  });

  if ((source.contentWindow as SampleWindow)?.anatomyExample) {
    void enable();
  }

  restart.addEventListener('click', () => {
    generation++;
    action++;
    picking = false;
    error = false;
    root.dataset.guide = 'start';
    clearTimeout(motionTimer);
    ready = undefined;
    panelLoaded = false;
    panelOpened = false;
    panel.removeAttribute('src');
    source.src = '/interactive/source.html';
    setView('page', 'page');
    root
      .querySelectorAll<HTMLButtonElement>('button')
      .forEach((button) => (button.disabled = true));
    showLoading('Reloading the example…');
    hint.textContent = 'Click the Anatomy tab to see how this page is composed.';
  });
  window.addEventListener('anatomy-example-pick', () => {
    picking = true;
    setView('page', 'page');

    // Escape must reach the visible sample, not the inspector frame we just hid.
    const body = source.contentDocument?.body;

    if (body) {
      body.tabIndex = -1;
      body.focus({ preventScroll: true });
    }

    hint.textContent = 'Click something on the page to find its component. Escape cancels.';
  });
  window.addEventListener('anatomy-example-highlight', () => {
    setView('page', 'page');
    hint.textContent = 'The selected component is highlighted. Open Anatomy to return.';
  });
  window.addEventListener('anatomy-example-picked', () => {
    if (!picking || error) {
      return;
    }

    picking = false;
    setView('anatomy', 'props');
    hint.textContent = 'Selected from the page. Explore its props or focus its subtree.';
  });
  window.addEventListener('anatomy-example-cancel-pick', () => {
    if (!picking) {
      return;
    }

    picking = false;
    setView('anatomy', 'explode');
    panel.contentDocument?.querySelector<HTMLButtonElement>('[aria-label="Pick on page"]')?.focus();
    hint.textContent = 'Picking cancelled. Select a layer or a component in the tree.';
  });
}
