import React, { useState, useEffect, memo, forwardRef, Fragment } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { WorkspaceApp } from '../../src/sample.tsx';
import styles from '../../src/style.css';

document.head.appendChild(
  Object.assign(document.createElement('style'), {
    textContent:
      styles +
      `body{background:#eeeef3;padding:40px;color:#343845}.fixture-controls{display:flex;gap:12px;margin-bottom:20px;align-items:center}.fixture-controls button{border:1px solid #aaa;background:white;color:#333;padding:8px 12px;border-radius:5px}.fixture-controls span{font-size:12px}.fixture-controls input{padding:8px}.fixture-extra{margin-top:12px;display:flex;gap:15px}.fixture-extra>span{padding:8px;background:#fff;border-radius:6px;color:#333}.portal-toast{position:fixed;right:25px;top:30px;padding:18px;background:#eee7fa;border:1px solid #bd9cd5;border-radius:10px;color:#6c4a7d}.other-root{position:absolute;left:1040px;top:180px;background:#ddece5;padding:20px;color:#345}`,
  }),
);

function NullOutput() {
  return null;
}

function Pair() {
  return (
    <Fragment>
      <span>Fragment: first</span>
      <span>Fragment: second</span>
    </Fragment>
  );
}

const MemoBadge = memo(function MemoBadge() {
  return <span>Memo component</span>;
});
const RefBadge = forwardRef<HTMLSpanElement>(function RefBadge(props, ref) {
  return <span ref={ref}>Forwarded ref</span>;
});

function Notification() {
  return createPortal(
    <div className="portal-toast">A React portal, still owned by this app.</div>,
    document.getElementById('portal')!,
  );
}

const circular: { label: string; self?: typeof circular } = { label: 'Cycle' };

circular.self = circular;

const guarded = {};

Object.defineProperty(guarded, 'secret', {
  enumerable: true,
  get() {
    window.propGetterCalls = (window.propGetterCalls || 0) + 1;

    throw new Error('Do not execute me');
  },
});

const inspectionData = {
  settings: { account: { team: { preferences: { palette: { primary: '#315cf5' } } } } },
  items: Array.from({ length: 125 }, (_, id) => ({
    id,
    label: `Item ${id}`,
    enabled: id % 2 === 0,
  })),
  empty: null,
  missing: undefined,
  enabled: true,
  nan: NaN,
  infinity: Infinity,
  negativeZero: -0,
  bigint: 9007199254740993n,
  symbol: Symbol('fixture'),
  onChange: function fixtureCallback() {
    window.propCallbackCalls = (window.propCallbackCalls || 0) + 1;
  },
  circular,
  guarded,
  longText: 'Long text: ' + 'x'.repeat(12500) + ' THE END',
  lookup: new Map([
    ['alpha', { score: 7 }],
    ['beta', { score: 9 }],
  ]),
  tags: new Set(['design', 'engineering']),
  date: new Date('2026-01-02T00:00:00Z'),
  hostile: new Proxy(
    {},
    {
      ownKeys() {
        throw new Error('Cannot enumerate');
      },
    },
  ),
};

function PropsFixture(
  _props: typeof inspectionData & { version: number; children: React.ReactNode },
) {
  return <span>Props inspection fixture</span>;
}

function PropsExamples() {
  const [version, setVersion] = useState(1);
  const [mounted, setMounted] = useState(true);

  useEffect(() => {
    window.updateInspectedProps = () => setVersion((v) => v + 1);
    window.unmountInspectedProps = () => setMounted(false);

    return () => {
      delete window.updateInspectedProps;
      delete window.unmountInspectedProps;
    };
  }, []);

  return mounted ? (
    <PropsFixture {...inspectionData} version={version}>
      <span>Child prop content</span>
    </PropsFixture>
  ) : null;
}

function TestApp() {
  const [count, setCount] = useState(0);
  const [toast, setToast] = useState(false);

  return (
    <>
      <div className="fixture-controls">
        <button onClick={() => setCount((c) => c + 1)}>Update app ({count})</button>
        <button onClick={() => setToast((v) => !v)}>Toggle portal</button>
        <span>Separate app · no React Anatomy package or script</span>
      </div>
      <WorkspaceApp />
      <div className="fixture-extra">
        <Pair />
        <MemoBadge />
        <RefBadge />
      </div>
      <NullOutput />
      <PropsExamples />
      {toast && <Notification />}
    </>
  );
}

function AnotherRoot() {
  return <div className="other-root">A second React root</div>;
}

createRoot(document.getElementById('app')!).render(<TestApp />);
createRoot(document.getElementById('other-root')!).render(<AnotherRoot />);
