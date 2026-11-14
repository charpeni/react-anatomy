import type { CaptureBudget, Snapshot } from './types.ts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createTransport } from './transport.ts';
import { fontFacesOnly } from './snapshot.ts';
import { captureSnapshot } from './capture-client.ts';
import { nextCaptureBudget, captureLimitMessage } from './capture-budget.ts';
import { Glyph } from './Glyph.tsx';
import { Viewer } from './Viewer.tsx';
import inspectorStyles from './panel.css';

document.head.appendChild(
  Object.assign(document.createElement('style'), { textContent: inspectorStyles }),
);

const transport = createTransport();

function applyTheme() {
  const theme = globalThis.chrome?.devtools?.panels?.themeName;

  document.documentElement.dataset.theme = theme
    ? theme === 'dark'
      ? 'dark'
      : 'light'
    : matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
}

applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

const panels = globalThis.chrome?.devtools?.panels as
  | (typeof chrome.devtools.panels & {
      onThemeChanged?: { addListener: (callback: () => void) => void };
    })
  | undefined;

panels?.onThemeChanged?.addListener(applyTheme);

function friendlyError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);

  if (/Cannot access|permission|cannot be scripted|chrome:\/\//i.test(text)) {
    return 'Open React Anatomy from the extension button on the React page, or use its DevTools panel. Browser settings pages cannot be inspected.';
  }

  if (/No tab|No frame|closed|receiving end/i.test(text)) {
    return 'The inspected tab has closed or navigated away. Open React Anatomy again from the page you want to inspect.';
  }

  return text;
}

function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [follow, setFollow] = useState(false);
  const [changed, setChanged] = useState(false);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<{ id: string; time: number } | null>(null);
  const [count, setCount] = useState(0);
  const [overviewSelection, setOverviewSelection] = useState<string>();
  const current = useRef<Snapshot | null>(null);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const seenPick = useRef<string | null>(null);
  const generation = useRef(0);
  const captureBudget = useRef<CaptureBudget>({});
  const captureAbort = useRef<AbortController | null>(null);

  const capture = useCallback(async (options: { limits?: CaptureBudget; quiet?: boolean } = {}) => {
    if (inFlight.current) {
      return;
    }

    const startedGeneration = generation.current;

    inFlight.current = true;
    setBusy(true);
    setError(null);

    const controller = new AbortController();
    captureAbort.current = controller;
    try {
      const result = await captureSnapshot(
        transport.call,
        options.limits || captureBudget.current,
        controller.signal,
      );

      if (!result || result.version !== 1 || !Array.isArray(result.nodes)) {
        throw new Error('The page returned an unsupported snapshot.');
      }

      if (alive.current && startedGeneration === generation.current) {
        if (result.limits) {
          captureBudget.current = {
            maxComponents: result.limits.components,
            maxDepth: result.limits.depth,
            scopeId: result.scope?.id,
          };
        }

        current.current = result;
        setSnapshot(result);
        setChanged(false);
        setPicking(false);
        setCount((n) => n + 1);

        return true;
      }
    } catch (e) {
      if (
        alive.current &&
        startedGeneration === generation.current &&
        !options.quiet &&
        !controller.signal.aborted
      ) {
        setError(friendlyError(e));
      }

      return false;
    } finally {
      inFlight.current = false;

      if (alive.current) {
        setBusy(false);
      }
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    capture();

    let navigationTimer: ReturnType<typeof setTimeout> | undefined;
    const off = transport.onNavigate(() => {
      const nextGeneration = ++generation.current;

      captureAbort.current?.abort();
      current.current = null;
      captureBudget.current = {};
      setSnapshot(null);
      setPicking(false);
      setPicked(null);
      setError(null);
      clearTimeout(navigationTimer);

      let attempts = 0;

      const reconnect = async () => {
        if (!alive.current || nextGeneration !== generation.current) {
          return;
        }

        if (inFlight.current) {
          navigationTimer = setTimeout(reconnect, 100);

          return;
        }

        const ready = await capture({ quiet: attempts < 4 });

        if (!ready && attempts++ < 4) {
          navigationTimer = setTimeout(reconnect, 250 * attempts);
        }
      };

      // Chrome announces navigation before the new execution context is ready.
      navigationTimer = setTimeout(reconnect, 100);
    });

    const cleanup = () => {
      transport.call({ action: 'dispose' }).catch(() => {});
    };

    window.addEventListener('pagehide', cleanup);

    return () => {
      alive.current = false;
      captureAbort.current?.abort();
      clearTimeout(navigationTimer);
      off();
      window.removeEventListener('pagehide', cleanup);
      cleanup();
    };
  }, [capture]);
  useEffect(() => {
    let polling = false;
    let cancelled = false;
    const timer = setInterval(
      async () => {
        if (
          polling ||
          inFlight.current ||
          document.visibilityState === 'hidden' ||
          !current.current
        ) {
          return;
        }

        polling = true;

        try {
          const status = await transport.call({ action: 'status' });

          if (cancelled || !status || !current.current) {
            return;
          }

          setPicking(status.picking);

          if (status.picked && status.picked !== seenPick.current) {
            seenPick.current = status.picked;
            if (!current.current.nodes.some((node) => node.id === status.picked)) {
              await capture({ limits: { scopeId: status.picked } });
            }
            setPicked({ id: status.picked, time: Date.now() });
          }

          const newPage = status.url !== current.current.url;
          const dirty =
            newPage ||
            (status.expired && current.current.status === 'ready') ||
            status.revision !== current.current.revision;

          setChanged(dirty);

          const newlyMounted =
            current.current.status !== 'ready' && status.revision !== current.current.revision;

          if (dirty && (follow || newPage || newlyMounted)) {
            if (newPage) {
              current.current = null;
              captureBudget.current = {};
              setSnapshot(null);
            }

            await capture();
          }
        } catch (e) {
          if (!cancelled) {
            setError(friendlyError(e));
            setFollow(false);
            setPicking(false);
          }
        } finally {
          polling = false;
        }
      },
      picking ? 300 : follow ? 900 : 1800,
    );

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [follow, picking, capture]);
  useEffect(() => {
    const style = document.createElement('style');

    style.textContent = fontFacesOnly(snapshot?.fonts);
    document.head.appendChild(style);

    return () => style.remove();
  }, [snapshot]);

  async function pick() {
    try {
      if (picking) {
        await transport.call({ action: 'clear' });
        setPicking(false);
      } else {
        seenPick.current = null;
        await transport.call({ action: 'pick' });
        setPicking(true);
      }
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  async function onAction(action: 'inspect' | 'highlight' | 'clear', id = '') {
    try {
      const result =
        action === 'inspect' ? await transport.inspect?.(id) : await transport.call({ action, id });

      if (result?.ok === false) {
        setError(result.message);
      }
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  const ready = snapshot?.status === 'ready';
  const nextBudget = ready && snapshot.truncated ? nextCaptureBudget(snapshot.limits) : null;

  return (
    <div className="extension-app">
      <header className="app-header" aria-label="Inspection toolbar">
        <button
          className={'icon-button ' + (picking ? 'picking active' : '')}
          disabled={!ready || busy}
          aria-label={picking ? 'Cancel picker' : 'Pick on page'}
          aria-pressed={picking}
          onClick={pick}
          title="Select a component in the page (C)"
        >
          <Glyph type="pick" size={16} />
        </button>
        <button
          className="icon-button capture-button"
          aria-label="Capture"
          disabled={busy}
          onClick={() => capture()}
          title="Capture the current page (R)"
        >
          <Glyph type="reset" size={15} />
        </button>
        <span className="toolbar-separator" />
        <label className="follow-control">
          <input
            type="checkbox"
            checked={follow}
            disabled={!ready}
            onChange={(e) => setFollow(e.target.checked)}
          />
          Follow changes
        </label>
        <span className="toolbar-separator" />
        <div className="session" title={snapshot?.url}>
          {snapshot?.url || 'Connecting to inspected page…'}
        </div>
        <span className="toolbar-context">
          {transport.mode === 'devtools' ? 'top' : 'React Anatomy'}
        </span>
      </header>
      {picking && (
        <div className="connection-banner picker-banner" role="status">
          Click a component in the inspected page. Press Escape there to cancel.
        </div>
      )}
      {error && (
        <div className="connection-banner error-banner" role="alert">
          <span>{error}</span>
          <button aria-label="Dismiss message" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      )}
      {ready && snapshot.truncated && (
        <div className="connection-banner capture-limit-banner" role="status">
          <span>
            {captureLimitMessage(snapshot)}
            {!nextBudget && ' Focus a component to inspect more detail within it.'}
          </span>
          {nextBudget && (
            <button
              className="standard-button"
              aria-label="Capture more"
              disabled={busy}
              title={`Capture up to ${nextBudget.maxComponents.toLocaleString('en-US')} components and ${nextBudget.maxDepth.toLocaleString('en-US')} nested levels`}
              onClick={() => capture({ limits: { ...nextBudget, scopeId: snapshot.scope?.id } })}
            >
              {busy ? 'Capturing…' : 'Capture more'}
            </button>
          )}
        </div>
      )}
      {busy && (
        <div className="connection-banner" role="status">
          Capturing in small steps…{' '}
          <button onClick={() => captureAbort.current?.abort()}>Cancel capture</button>
        </div>
      )}
      {ready && snapshot.visualLimited && (
        <div className="connection-banner" role="status">
          Visual detail is limited. Focus a component for a more detailed capture.
        </div>
      )}
      {ready ? (
        <Viewer
          key={snapshot.scope?.id || 'overview'}
          snapshot={snapshot}
          picked={picked}
          call={transport.call}
          canInspect={!!transport.inspect}
          onAction={onAction}
          onCapture={capture}
          onPick={pick}
          onScope={(scopeId) => {
            if (!snapshot.scope && scopeId) {
              setOverviewSelection(scopeId);
            }
            void capture({ limits: scopeId ? { scopeId } : {} });
          }}
          initialSelection={overviewSelection}
          busy={busy}
        />
      ) : (
        <div className="empty-state">
          <h1>{busy ? 'Reading React components…' : 'No React components to inspect'}</h1>
          <p>
            {snapshot?.message ||
              error ||
              'Open a page with a mounted React app to inspect its component hierarchy.'}
          </p>
          <button className="standard-button" disabled={busy} onClick={() => capture()}>
            {busy ? 'Connecting…' : 'Capture page'}
          </button>
          <p className="setup-hint">Development builds provide the clearest component names.</p>
        </div>
      )}
      <footer className="extension-footer">
        <span className={changed ? 'changed' : ''}>
          {busy
            ? 'Capturing…'
            : changed
              ? 'Page changed since capture'
              : ready
                ? 'Snapshot'
                : 'Waiting for React'}
        </span>
        {changed && !busy && <button onClick={() => capture()}>Update snapshot</button>}
        <span className="footer-meta">
          {ready
            ? `${snapshot.nodes.length} components · ${snapshot.rootCount} root${snapshot.rootCount === 1 ? '' : 's'} · ${snapshot.captureMs} ms`
            : ''}
        </span>
        <span className="footer-count">{count ? `Capture ${count}` : ''}</span>
      </footer>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
