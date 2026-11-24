export function enableHeroDrift(stage: HTMLElement) {
  const motion = matchMedia(
    '(any-hover: hover) and (any-pointer: fine) and (prefers-reduced-motion: no-preference)',
  );
  const planes = Array.from(
    stage.querySelectorAll<HTMLElement>('.hero-plane:not(.hero-plane-links)'),
  );
  let pointerX = 0;
  let pointerY = 0;
  let frame = 0;

  function drift() {
    frame = 0;
    const offsets = planes.map((plane) => {
      const { left, top, width, height } = plane.getBoundingClientRect();
      // Give each plane a soft area of influence that extends past its edges.
      const dx = (left + width / 2 - pointerX) / (width / 2 + 100);
      const dy = (top + height / 2 - pointerY) / (height / 2 + 100);
      // Emphasis already travels with its parent heading.
      const travel = plane.classList.contains('hero-plane-emphasis') ? 14 : 28;
      const weight = travel * Math.exp(-(dx * dx + dy * dy));
      return `${(dx * weight).toFixed(2)}px ${(dy * weight).toFixed(2)}px`;
    });

    planes.forEach((plane, index) => {
      plane.style.translate = offsets[index];
    });
  }

  function settle() {
    cancelAnimationFrame(frame);
    frame = 0;
    planes.forEach((plane) => plane.style.removeProperty('translate'));
  }

  stage.addEventListener('pointermove', (event) => {
    if (!motion.matches || event.pointerType === 'touch' || event.buttons !== 0) return;
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (!frame) frame = requestAnimationFrame(drift);
  });
  stage.addEventListener('pointerleave', settle);
  stage.addEventListener('pointercancel', settle);
  window.addEventListener('blur', settle);
  motion.addEventListener('change', settle);
}
