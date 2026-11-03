type Rotation = { x: number; y: number };
type Drag = {
  pointerId: number;
  touch: boolean;
  startX: number;
  startY: number;
  rotation: Rotation;
  moved: boolean;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function enableExploded404(stage: HTMLElement) {
  const scene = stage.querySelector<HTMLElement>('.not-found-scene');
  const hint = document.getElementById('not-found-hint');

  if (!scene || !hint) {
    return;
  }

  let rotation: Rotation | null = null;
  let drag: Drag | null = null;

  const currentRotation = (): Rotation => {
    const style = getComputedStyle(scene);

    return (
      rotation ?? {
        x: Number.parseFloat(style.getPropertyValue('--rotate-x')),
        y: Number.parseFloat(style.getPropertyValue('--rotate-y')),
      }
    );
  };

  const finishEntrance = () => scene.classList.remove('is-entering');
  const apply = (next: Rotation) => {
    rotation = { x: clamp(next.x, 0, 40), y: clamp(next.y, -45, 25) };
    scene.style.transform = `translateX(var(--offset)) rotateX(${rotation.x}deg) rotateY(${rotation.y}deg) scale(var(--scale))`;
  };

  const endDrag = () => {
    const pointerId = drag?.pointerId;

    drag = null;
    stage.classList.remove('is-dragging');

    if (pointerId !== undefined && stage.hasPointerCapture(pointerId)) {
      stage.releasePointerCapture(pointerId);
    }
  };

  stage.tabIndex = 0;
  stage.setAttribute('aria-describedby', hint.id);
  stage.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight ArrowUp ArrowDown');
  stage.classList.add('is-interactive');
  hint.hidden = false;

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  if (!reducedMotion.matches) {
    scene.classList.add('is-entering');
    scene.addEventListener('animationend', finishEntrance, { once: true });
  }

  reducedMotion.addEventListener('change', finishEntrance);
  stage.addEventListener('focusin', finishEntrance);

  stage.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary) {
      endDrag();
      return;
    }

    if (event.button !== 0 || (event.target instanceof Element && event.target.closest('a'))) {
      return;
    }

    finishEntrance();
    drag = {
      pointerId: event.pointerId,
      touch: event.pointerType === 'touch',
      startX: event.clientX,
      startY: event.clientY,
      rotation: currentRotation(),
      moved: false,
    };
  });

  stage.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;

    if (!drag.moved) {
      if (Math.hypot(dx, dy) < 4) {
        return;
      }

      // Let the browser own vertical scrolling and pinch zoom on touch screens.
      if (drag.touch && Math.abs(dy) > Math.abs(dx)) {
        endDrag();
        return;
      }

      drag.moved = true;

      if (!drag.touch) {
        stage.setPointerCapture(event.pointerId);
      }

      stage.classList.add('is-dragging');
    }

    apply({
      x: drag.touch ? drag.rotation.x : drag.rotation.x - dy * 0.12,
      y: drag.rotation.y + dx * 0.16,
    });
  });

  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    stage.addEventListener(type, (event) => {
      if (event.pointerId === drag?.pointerId) {
        endDrag();
      }
    });
  }

  window.addEventListener('blur', endDrag);

  stage.addEventListener('keydown', (event) => {
    if (event.target !== stage || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    const steps: Record<string, Rotation> = {
      ArrowLeft: { x: 0, y: -6 },
      ArrowRight: { x: 0, y: 6 },
      ArrowUp: { x: 4, y: 0 },
      ArrowDown: { x: -4, y: 0 },
    };
    const step = steps[event.key];

    if (!step) {
      return;
    }

    event.preventDefault();
    finishEntrance();
    endDrag();

    const current = currentRotation();

    apply({ x: current.x + step.x, y: current.y + step.y });
  });
}
