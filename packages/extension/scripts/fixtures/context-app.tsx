import React, { Component, createContext, memo, useContext, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';

// A page for "who reads this context". ThemeContext has exactly three readers
// and one component that is not a reader. The two buttons are repeatable:
//
// - "Switch theme" changes the provider's value. Only the three readers render.
// - "Re-render app" renders the tree with the same value. The memoized reader
//   is skipped, and the component that is not a reader renders too.
//
// Every component counts its own calls so tests can check measured renders
// against what actually ran.
type Theme = { name: 'light' | 'dark'; surface: string; text: string; accent: string };

const themes: Record<Theme['name'], Theme> = {
  light: { name: 'light', surface: '#ffffff', text: '#20232b', accent: '#315cf5' },
  dark: { name: 'dark', surface: '#20232b', text: '#f1f2f6', accent: '#9db4ff' },
};
const ThemeContext = createContext(themes.light);

ThemeContext.displayName = 'ThemeContext';

const calls: Record<string, number> = (window.contextFixtureRenders = {});

function ran(name: string) {
  calls[name] = (calls[name] || 0) + 1;
}

function ThemeBoundary({ children }: { children: React.ReactNode }) {
  const [name, setName] = useState<Theme['name']>('light');
  // The value changes identity only when the theme does.
  const theme = useMemo(() => ({ ...themes[name] }), [name]);

  ran('ThemeBoundary');

  return (
    <section className="theme-boundary" style={{ background: theme.surface, color: theme.text }}>
      <button id="toggle-theme" onClick={() => setName(name === 'light' ? 'dark' : 'light')}>
        Switch to {name === 'light' ? 'dark' : 'light'} theme
      </button>
      <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
    </section>
  );
}

function ThemedHeading() {
  const theme = useContext(ThemeContext);

  ran('ThemedHeading');

  return (
    <h2 data-reader="heading" style={{ color: theme.accent }}>
      Heading reads the {theme.name} theme
    </h2>
  );
}

const ThemedBadge = memo(function ThemedBadge() {
  const theme = useContext(ThemeContext);

  ran('ThemedBadge');

  return (
    <span data-reader="badge" className="badge" style={{ borderColor: theme.accent }}>
      Memoized badge · {theme.name}
    </span>
  );
});

function ThemedToast() {
  const theme = useContext(ThemeContext);

  ran('ThemedToast');

  return (
    <div data-reader="toast" className="toast" style={{ background: theme.accent }}>
      Portal toast · {theme.name}
    </div>
  );
}

function StaticCaption() {
  ran('StaticCaption');

  return <p data-reader="none">Caption does not read the theme.</p>;
}

// Harder cases, kept out of ThemeContext's subtree so its counts stay simple.
const AccentContext = createContext('none');

AccentContext.displayName = 'AccentContext';

// An alias is the same context object under another name.
const AccentAlias = AccentContext;
// A different context that happens to share the display name.
const LookalikeContext = createContext('lookalike');

LookalikeContext.displayName = 'AccentContext';

function OuterAccent() {
  return <li>Hook reads {useContext(AccentContext)}</li>;
}

function AliasAccent() {
  return <li>Alias reads {useContext(AccentAlias)}</li>;
}

class ClassAccent extends Component {
  static contextType = AccentContext;
  declare context: React.ContextType<typeof AccentContext>;

  render() {
    return <li>Class reads {this.context}</li>;
  }
}

function ConsumerAccent() {
  return (
    <AccentContext.Consumer>{(accent) => <li>Consumer reads {accent}</li>}</AccentContext.Consumer>
  );
}

const ComparedAccent = memo(
  function ComparedAccent() {
    return <li>Compared memo reads {useContext(AccentContext)}</li>;
  },
  () => true,
);

function InnerAccent() {
  return <li>Nested reader reads {useContext(AccentContext)}</li>;
}

function LookalikeReader() {
  return <li>Lookalike reads {useContext(LookalikeContext)}</li>;
}

function PlainItem() {
  return <li>Plain item reads nothing</li>;
}

const EdgeCases = memo(function EdgeCases() {
  return (
    <section className="edge-cases">
      <h2>Accent context</h2>
      <AccentContext.Provider value="outer">
        <ul>
          <OuterAccent />
          <AliasAccent />
          <ClassAccent />
          <ConsumerAccent />
          <ComparedAccent />
          <LookalikeReader />
          <PlainItem />
          <AccentContext value="inner">
            <InnerAccent />
          </AccentContext>
        </ul>
      </AccentContext.Provider>
    </section>
  );
});

// Outside the provider, in the first root: reads ThemeContext's default value.
function UnthemedFooter() {
  const theme = useContext(ThemeContext);

  return <p className="detached">First root, outside the provider: default {theme.name} theme</p>;
}

// Only at /context?stress, so the page above keeps its simple counts. React
// records every read, which makes these dependency lists very long.
const NoiseContext = createContext('noise');

function readNoise(times: number) {
  for (let read = 0; read < times; read++) {
    // oxlint-disable-next-line react-hooks/rules-of-hooks -- A fixed number of reads, to build a long dependency list.
    useContext(NoiseContext);
  }
}

// Reads one context 150 times and then the accent: still a reader.
function RepeatReader() {
  readNoise(150);

  return <li>Repeat reader reads {useContext(AccentContext)}</li>;
}

// Reads so often that the inspector stops before it reaches the accent. It
// must then be reported as unchecked, never as "not a reader".
function ExcessReader() {
  readNoise(5001);

  return <li>Excess reader reads {useContext(AccentContext)}</li>;
}

function StressCases() {
  const [value, setValue] = useState(0);

  return (
    <section className="edge-cases">
      <h2>Long dependency lists</h2>
      <button id="change-stress" onClick={() => setValue(value + 1)}>
        Change stress value ({value})
      </button>
      <AccentContext.Provider value={`stress ${value}`}>
        <ul>
          <RepeatReader />
          <ExcessReader />
          <PlainItem />
        </ul>
      </AccentContext.Provider>
    </section>
  );
}

function ContextFixture() {
  const [tick, setTick] = useState(0);

  return (
    <main>
      <h1>Context readers</h1>
      <button id="rerender-app" onClick={() => setTick(tick + 1)}>
        Re-render app ({tick})
      </button>
      <ThemeBoundary>
        <ThemedHeading />
        <ThemedBadge />
        <StaticCaption />
        {createPortal(<ThemedToast />, document.getElementById('context-portal')!)}
      </ThemeBoundary>
      <EdgeCases />
      {location.search === '?stress' && <StressCases />}
      <UnthemedFooter />
    </main>
  );
}

// A second root has no provider either. Its reader is listed apart from the
// first root's: roots share no providers, so nothing connects the two.
function DetachedReader() {
  const theme = useContext(ThemeContext);

  return <p className="detached">Second root reads the default {theme.name} theme</p>;
}

document.head.appendChild(
  Object.assign(document.createElement('style'), {
    textContent: `body{margin:0;padding:40px 48px;background:#eeeef3;color:#343845;font:18px/1.5 system-ui,sans-serif}h1{margin:0 0 16px;font-size:30px}h2{margin:14px 0 8px;font-size:22px}button{padding:10px 16px;border:1px solid #aaa;border-radius:6px;background:#fff;color:#333;font:inherit}.theme-boundary{width:640px;margin:20px 0;padding:24px;border:1px solid #c9cbd6;border-radius:12px}.badge{display:inline-block;padding:4px 14px;border:2px solid;border-radius:16px}.toast{position:fixed;top:40px;left:800px;padding:18px 24px;border-radius:12px;color:#fff}.edge-cases{width:640px;padding:8px 24px;border:1px solid #c9cbd6;border-radius:12px;background:#fff}.edge-cases ul{margin:0 0 16px;padding-left:22px}.detached{width:640px;margin:20px 0 0;padding:16px 24px;border-radius:12px;background:#ddece5}`,
  }),
);

createRoot(document.getElementById('app')!).render(<ContextFixture />);
createRoot(document.getElementById('context-other-root')!).render(<DetachedReader />);
