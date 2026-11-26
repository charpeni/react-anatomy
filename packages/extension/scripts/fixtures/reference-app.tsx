import React, { memo, useEffect, useState } from 'react';
import { jsx } from 'react/jsx-runtime';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';

// Controls for "Find same reference". The answer key is this file: `save` is
// created once in ReferenceApp and reaches components under different prop
// names; equal primitives and an equal-looking function must not match it.
declare global {
  interface Window {
    referenceGetterCalls?: number;
    referenceCallbackCalls?: number;
    replaceReference?: () => void;
    unmountReferenceForm?: () => void;
  }
}

type Save = () => void;

// One module-level object, imported independently by two React roots.
const sharedTheme = { name: 'shared' };
const rows = ['alpha', 'beta', 'gamma', 'delta'].map((id) => ({ id }));

function Toolbar({ label }: { onSave: Save; label: string; count: number }) {
  return <header>{label} toolbar</header>;
}

// Receives its content as children and no callback: a gap between two holders.
function Relay({ children }: { children: React.ReactNode }) {
  return <div className="relay">{children}</div>;
}

function SubmitButton({ onPress }: { onPress: Save }) {
  return <button onClick={onPress}>Submit</button>;
}

function NoOutput(_props: { onSave: Save }) {
  return null;
}

function PortalAction(_props: { action: Save }) {
  return <span>Portal action</span>;
}

function Dialog({ handler }: { handler: Save }) {
  return createPortal(<PortalAction action={handler} />, document.getElementById('portal')!);
}

function Form({ handler }: { handler: Save; theme: object; label: string }) {
  return (
    <form>
      <SubmitButton onPress={handler} />
      <NoOutput onSave={handler} />
      <Dialog handler={handler} />
    </form>
  );
}

function Row({ item }: { item: { id: string }; onSelect: Save }) {
  return <li>{item.id}</li>;
}

const MemoLeaf = memo(function MemoLeaf(_props: { onSave: Save; count: number }) {
  return <span>Memo leaf</span>;
});

function Guarded(_props: object) {
  return <span>Guarded props</span>;
}

function Hostile(_props: object) {
  return <span>Hostile props</span>;
}

function Panel({
  onSubmit,
  theme,
  items,
  showForm,
}: {
  onSubmit: Save;
  theme: object;
  items: { id: string }[];
  label: string;
  count: number;
  showForm: boolean;
}) {
  return (
    <section>
      {showForm && (
        <Relay>
          <Form handler={onSubmit} theme={theme} label="same" />
        </Relay>
      )}
      <ul>
        {items.map((item, index) => (
          <Row key={item.id} item={item} onSelect={index === 3 ? lookalike : onSubmit} />
        ))}
      </ul>
    </section>
  );
}

// The same source text as `save`, but a different function object.
function lookalike() {
  window.referenceCallbackCalls = (window.referenceCallbackCalls || 0) + 1;
}

// React keeps a props object passed straight to jsx(), so this getter reaches
// the Fiber as an accessor. React reads every prop of an element it renders
// again in development, so both hostile elements are created only once.
const guardedElement = jsx(
  Guarded,
  Object.defineProperty({ theme: sharedTheme }, 'secret', {
    enumerable: true,
    get() {
      window.referenceGetterCalls = (window.referenceGetterCalls || 0) + 1;

      throw new Error('Do not execute me');
    },
  }),
);

// A props object that refuses reflection once React has mounted it.
let hostileArmed = false;
const hostileElement = jsx(
  Hostile,
  new Proxy(
    {},
    {
      ownKeys() {
        if (hostileArmed) {
          throw new Error('Cannot enumerate');
        }

        return [];
      },
    },
  ),
);

// Each call returns a new function object with identical source.
function makeSave(): Save {
  return function save() {
    window.referenceCallbackCalls = (window.referenceCallbackCalls || 0) + 1;
  };
}

function ReferenceApp() {
  const [save, setSave] = useState(makeSave);
  const [showForm, setShowForm] = useState(true);

  useEffect(() => {
    window.replaceReference = () => setSave(makeSave);
    window.unmountReferenceForm = () => setShowForm(false);
    hostileArmed = true;

    return () => {
      delete window.replaceReference;
      delete window.unmountReferenceForm;
    };
  }, []);

  return (
    <main>
      <Toolbar onSave={save} label="same" count={3} />
      <Panel
        onSubmit={save}
        theme={sharedTheme}
        items={rows}
        label="same"
        count={3}
        showForm={showForm}
      />
      <MemoLeaf onSave={save} count={3} />
      {guardedElement}
      {hostileElement}
    </main>
  );
}

function OtherRoot(_props: { theme: object }) {
  return <aside>A second React root</aside>;
}

createRoot(document.getElementById('app')!).render(<ReferenceApp />);
createRoot(document.getElementById('other-root')!).render(<OtherRoot theme={sharedTheme} />);
