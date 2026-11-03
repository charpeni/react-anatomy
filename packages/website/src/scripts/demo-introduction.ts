const sessionKey = 'react-anatomy.demo-introduction';

type IntroductionOptions = {
  root: HTMLElement;
  prepare: () => Promise<Document>;
  open: (instant: boolean) => Promise<void>;
  cancelOpen: () => void;
};

export function mountDemoIntroduction({ root, prepare, open, cancelOpen }: IntroductionOptions) {
  const tab = root.querySelector<HTMLButtonElement>('[data-view="anatomy"]')!;
  const cursor = root.querySelector<HTMLElement>('.demo-intro-cursor')!;
  const skip = root.querySelector<HTMLButtonElement>('.demo-intro-skip')!;
  const status = root.querySelector<HTMLElement>('.demo-intro-status')!;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const easeOut = getComputedStyle(root).getPropertyValue('--ease-out').trim();
  const animations = new Set<Animation>();
  const observed = new WeakSet<Document>();
  let state: 'waiting' | 'playing' | 'opening' | 'done' = 'waiting';
  let holdingScroll = false;
  let lockedY = 0;
  let lastY = scrollY;
  let restoreScroll: (() => void) | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let run: AbortController | undefined;

  try {
    if (sessionStorage.getItem(sessionKey)) {
      state = 'done';
    }
  } catch {
    // Storage may be disabled. The in-memory state still limits this page to one run.
  }

  root.dataset.introduction = state;

  function remember() {
    try {
      sessionStorage.setItem(sessionKey, 'seen');
    } catch {
      // The introduction does not depend on browser storage being available.
    }
  }

  function finish(cancelled = false) {
    if (state === 'done') {
      return;
    }

    if (cancelled && state === 'opening') {
      cancelOpen();
    }

    state = 'done';
    root.dataset.introduction = 'done';
    remember();
    run?.abort();
    clearTimeout(deadline);
    animations.forEach((animation) => animation.cancel());
    animations.clear();
    cursor.hidden = true;
    skip.hidden = true;
    status.textContent = '';
    holdingScroll = false;
    restoreScroll?.();
    restoreScroll = undefined;
    lastY = scrollY;
  }

  const cancel = () => finish(true);

  function holdScroll() {
    const style = document.documentElement.style;
    const previous = {
      overflow: style.overflow,
      scrollbarGutter: style.scrollbarGutter,
      overscrollBehavior: style.overscrollBehavior,
    };

    lockedY = scrollY;
    holdingScroll = true;
    if (innerWidth > document.documentElement.clientWidth) {
      style.scrollbarGutter = 'stable';
    }
    style.overflow = 'hidden';
    style.overscrollBehavior = 'none';
    restoreScroll = () => Object.assign(style, previous);
  }

  async function animate(frames: Keyframe[], duration: number, signal: AbortSignal) {
    if (signal.aborted) {
      return;
    }

    const animation = cursor.animate(frames, { duration, easing: easeOut, fill: 'forwards' });

    animations.add(animation);
    await animation.finished.catch(() => undefined);
  }

  function pause(duration: number, signal: AbortSignal) {
    return new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }

      const complete = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', complete);
        resolve();
      };
      const timer = setTimeout(complete, duration);

      signal.addEventListener('abort', complete, { once: true });
    });
  }

  async function play() {
    remember();
    run = new AbortController();
    const { signal } = run;

    if (reducedMotion.matches) {
      state = 'opening';
      root.dataset.introduction = state;
      try {
        await open(true);
      } finally {
        finish();
      }
      return;
    }

    state = 'playing';
    root.dataset.introduction = state;
    holdScroll();
    skip.hidden = false;
    status.textContent = 'Opening Anatomy. Press Escape or Skip intro to continue scrolling.';
    // Always release scrolling, even if the iframe fails to load or the animation is interrupted.
    deadline = setTimeout(cancel, 3500);

    const bounds = root.getBoundingClientRect();
    const target = tab.getBoundingClientRect();
    const x = target.x - bounds.x + target.width * 0.58;
    const y = target.y - bounds.y + target.height * 0.5;
    const startX = Math.min(bounds.width - 42, x + 160);
    const startY = y + 180;
    const atTarget = `translate(${x}px, ${y}px)`;

    cursor.hidden = false;

    try {
      // Prepare the real inspector while the cursor travels, keeping Orbit visible.
      await Promise.all([
        prepare(),
        animate(
          [
            { transform: `translate(${startX}px, ${startY}px)`, opacity: 0 },
            {
              transform: `translate(${startX - 12}px, ${startY - 16}px)`,
              opacity: 1,
              offset: 0.18,
            },
            { transform: atTarget, opacity: 1 },
          ],
          850,
          signal,
        ),
      ]);
      if (signal.aborted) {
        return;
      }

      await pause(160, signal);
      if (signal.aborted) {
        return;
      }

      await animate(
        [
          { transform: `${atTarget} scale(1)`, opacity: 1 },
          { transform: `${atTarget} scale(0.86)`, opacity: 1 },
        ],
        120,
        signal,
      );
      if (signal.aborted) {
        return;
      }

      state = 'opening';
      root.dataset.introduction = state;
      void animate(
        [
          { transform: `${atTarget} scale(0.86)`, opacity: 1 },
          { transform: atTarget, opacity: 0 },
        ],
        220,
        signal,
      );
      await open(false);
      if (signal.aborted) {
        return;
      }

      // Let the panel's 700 ms explanation finish before scrolling continues.
      await pause(760, signal);
      finish();
    } catch {
      cancel();
    }
  }

  function onScroll() {
    if (holdingScroll) {
      if (scrollY !== lockedY) {
        window.scrollTo({ top: lockedY, behavior: 'instant' });
      }
      return;
    }

    const movingDown = scrollY > lastY;
    lastY = scrollY;
    if (state !== 'waiting' || !movingDown || tab.disabled || document.hidden) {
      return;
    }
    if (root.dataset.guide !== 'start') {
      cancel();
      return;
    }

    const bounds = root.getBoundingClientRect();
    const windowHeight = root.querySelector<HTMLElement>('.demo-window')!.offsetHeight;
    const anchor = Math.max(16, Math.min(96, (innerHeight - windowHeight) / 2));

    if (bounds.top > anchor) {
      return;
    }
    if (bounds.bottom < Math.min(420, innerHeight * 0.6)) {
      // A jump to a section farther down the page should never pull the reader back.
      cancel();
      return;
    }

    if (!reducedMotion.matches) {
      window.scrollTo({ top: Math.max(0, scrollY + bounds.top - anchor), behavior: 'instant' });
    }
    void play().catch(cancel);
  }

  function observe(doc: Document) {
    if (observed.has(doc)) {
      return;
    }
    observed.add(doc);
    doc.addEventListener(
      'keydown',
      (event) => {
        if (
          [
            'Escape',
            'Tab',
            'ArrowUp',
            'ArrowDown',
            'PageUp',
            'PageDown',
            'Home',
            'End',
            ' ',
          ].includes(event.key) ||
          holdingScroll ||
          root.contains(event.target as Node)
        ) {
          cancel();
        }
      },
      true,
    );
    doc.addEventListener(
      'pointerdown',
      (event) => {
        if (
          event.pointerType !== 'touch' &&
          (holdingScroll || doc !== document || root.contains(event.target as Node))
        ) {
          cancel();
        }
      },
      true,
    );
    // A swipe is not an interaction with the demo. Only a completed touch tap takes over.
    doc.addEventListener(
      'click',
      (event) => {
        if (
          event.isTrusted &&
          (holdingScroll || doc !== document || root.contains(event.target as Node))
        ) {
          cancel();
        }
      },
      true,
    );
    doc.addEventListener(
      'touchmove',
      (event) => {
        if (holdingScroll && event.touches.length === 1) {
          event.preventDefault();
        }
      },
      { passive: false },
    );
  }

  observe(document);
  for (const frame of root.querySelectorAll('iframe')) {
    frame.addEventListener('load', () => {
      if (frame.contentDocument) {
        observe(frame.contentDocument);
      }
    });
    if (frame.contentDocument) {
      observe(frame.contentDocument);
    }
  }

  document.addEventListener(
    'wheel',
    (event) => {
      if (!holdingScroll || event.ctrlKey || event.metaKey) {
        return;
      }
      if (event.deltaY < 0) {
        cancel();
      } else {
        event.preventDefault();
      }
    },
    { passive: false },
  );
  skip.addEventListener('click', cancel);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('pagehide', cancel);
  window.addEventListener('resize', () => {
    if (holdingScroll) {
      cancel();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && holdingScroll) {
      cancel();
    }
  });
  reducedMotion.addEventListener('change', () => {
    if (holdingScroll) {
      cancel();
    }
  });

  return {
    cancel,
    get holdingScroll() {
      return holdingScroll;
    },
  };
}
