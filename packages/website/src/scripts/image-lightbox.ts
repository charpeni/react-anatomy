import PhotoSwipeLightbox from 'photoswipe/lightbox';

export function mountImageLightbox() {
  const main = document.querySelector('main');

  if (!main) {
    return;
  }

  const links = [...main.querySelectorAll<HTMLAnchorElement>('a[href]')].filter((link) => {
    return (
      link.querySelector('img') &&
      !link.hasAttribute('download') &&
      /\.(png|jpe?g|webp|avif|gif|svg)$/i.test(new URL(link.href).pathname)
    );
  });

  if (!links.length) {
    return;
  }

  const sizes = new WeakMap<HTMLAnchorElement, Promise<void>>();

  function measure(link: HTMLAnchorElement) {
    let pending = sizes.get(link);

    if (!pending) {
      pending = (async () => {
        const image = new Image();

        image.src = link.href;

        try {
          await image.decode();
          link.dataset.pswpWidth = String(image.naturalWidth);
          link.dataset.pswpHeight = String(image.naturalHeight);
        } catch {
          // Let PhotoSwipe show its image-loading error in the dialog.
          sizes.delete(link);
        }
      })();
      sizes.set(link, pending);
    }

    return pending;
  }

  for (const link of links) {
    link.dataset.imageViewer = '';
    link.setAttribute('aria-haspopup', 'dialog');
    link.setAttribute(
      'aria-label',
      `Enlarge image: ${link.querySelector('img')?.alt || 'Screenshot'}`,
    );
    link.title = 'Open image viewer';
  }

  const lightbox = new PhotoSwipeLightbox({
    gallery: main,
    children: 'a[data-image-viewer]',
    pswpModule: () => import('photoswipe'),
    // Markdown images have no explicit dimensions. Resolve full-size dimensions
    // on first interaction, before the viewer computes its fit and zoom levels.
    openPromise: () => Promise.all(links.map(measure)),
    preloadFirstSlide: false,
    showHideAnimationType: 'fade',
    showAnimationDuration: 160,
    hideAnimationDuration: 120,
    zoomAnimationDuration: 200,
    bgOpacity: 0.94,
    loop: false,
    closeTitle: 'Close image viewer',
    zoomTitle: 'Zoom image',
    arrowPrevTitle: 'Previous image',
    arrowNextTitle: 'Next image',
    errorMsg: 'This image could not be loaded. Close the viewer and try again.',
    paddingFn: (viewport) => ({
      top: 64,
      bottom: 24,
      left: viewport.x < 600 ? 12 : 48,
      right: viewport.x < 600 ? 12 : 48,
    }),
  });

  let opener: HTMLAnchorElement | undefined;
  let closeWhenOpen = false;
  let previousOverflow: string | undefined;
  const background = new Map<HTMLElement, boolean>();

  lightbox.addFilter('clickedIndex', (index, event) => {
    opener = links[index];
    closeWhenOpen = false;

    const instant = event.detail === 0 || matchMedia('(prefers-reduced-motion: reduce)').matches;

    lightbox.options.showAnimationDuration = instant ? 0 : 160;
    lightbox.options.hideAnimationDuration = instant ? 0 : 120;
    lightbox.options.zoomAnimationDuration = instant ? 0 : 200;

    return index;
  });
  lightbox.on('afterInit', () => {
    const dialog = lightbox.pswp?.element;

    dialog?.setAttribute('aria-modal', 'true');
    dialog?.setAttribute('aria-label', 'Image viewer');

    for (const element of document.body.children) {
      if (element instanceof HTMLElement && element !== dialog) {
        background.set(element, element.inert);
        element.inert = true;
      }
    }

    previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
  });
  lightbox.on('openingAnimationEnd', () => {
    if (closeWhenOpen) {
      lightbox.pswp?.close();

      return;
    }

    lightbox.pswp?.element
      ?.querySelector<HTMLButtonElement>('.pswp__button--close')
      ?.focus({ preventScroll: true });
  });
  lightbox.on('destroy', () => {
    closeWhenOpen = false;

    for (const [element, inert] of background) {
      element.inert = inert;
    }

    background.clear();

    if (previousOverflow !== undefined) {
      document.documentElement.style.overflow = previousOverflow;
    }

    previousOverflow = undefined;
    opener?.focus({ preventScroll: true });
  });

  const handleKeydown = (event: KeyboardEvent) => {
    const dialog = lightbox.pswp?.element;

    if (event.key === 'Tab' && dialog) {
      // Inert background content alone lets Tab leave for the browser toolbar.
      // Wrap at the dialog's visible controls in both directions.
      const controls = [
        ...dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => element.getClientRects().length > 0);
      const target = event.shiftKey ? controls.at(-1) : controls[0];
      const boundary = event.shiftKey ? controls[0] : controls.at(-1);

      if (document.activeElement === boundary || document.activeElement === dialog) {
        event.preventDefault();
        (target || dialog).focus({ preventScroll: true });
      }
    }

    if (event.key !== 'Escape') {
      return;
    }

    if (lightbox.pswp?.opener.isOpening) {
      closeWhenOpen = true;
      event.preventDefault();
    } else if (!lightbox.pswp && lightbox.shouldOpen) {
      lightbox.shouldOpen = false;
      event.preventDefault();
    }
  };

  document.addEventListener('keydown', handleKeydown, true);
  lightbox.init();

  return () => {
    document.removeEventListener('keydown', handleKeydown, true);
    lightbox.destroy();
  };
}
