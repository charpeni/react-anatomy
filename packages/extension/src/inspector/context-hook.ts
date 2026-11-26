// React reports commits only to a DevTools-style hook that exists before React
// loads. A page without one cannot have its renders counted after the fact, so
// the panel offers to reload it with this function injected first. Like the
// page agent, it is serialized into the inspected page: keep it self-contained.
//
// The hook lives on Window.prototype, not on window. React finds it through an
// ordinary global lookup, while React DevTools, which looks for an own property
// of window, still installs its own hook and takes precedence.
export function installCommitHook() {
  const name = '__REACT_DEVTOOLS_GLOBAL_HOOK__';

  if (name in window) {
    return;
  }

  const renderers = new Map<number, unknown>();
  const hook = {
    renderers,
    supportsFiber: true,
    inject(renderer: unknown) {
      const id = renderers.size + 1;

      renderers.set(id, renderer);

      return id;
    },
    onCommitFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
  };

  Object.defineProperty(Window.prototype, name, {
    configurable: true,
    enumerable: false,
    get: () => hook,
    // A page that assigns its own hook, for example to disable DevTools, keeps it.
    set(value: unknown) {
      Object.defineProperty(this, name, {
        configurable: true,
        enumerable: true,
        writable: true,
        value,
      });
    },
  });
}
