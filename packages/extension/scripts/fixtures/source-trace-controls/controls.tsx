import { createRoot } from 'react-dom/client';
import { createPortal as portal } from 'react-dom';
/* oxlint-disable no-unused-vars, no-eval, no-func-assign, oxc/only-used-in-recursion -- These components deliberately ignore, hide, or only relay props: that is what the analyzer is checked against. */
import {
  Children,
  Component,
  createContext,
  isValidElement,
  forwardRef,
  memo,
  useEffect,
} from 'react';
// @ts-expect-error -- deliberately unresolvable: an implementation without source.
import { External } from 'not-installed-library';

// Small, separate cases for the analyzer's claims. They are analyzed by
// scripts/check-source-trace.ts and never rendered. Each comment states the
// answer the trace must give for the named prop.

const Theme = createContext<object>({});

function Leaf({ value }: { value?: string; extra?: string }) {
  return <i>{value}</i>;
}

function Ignorer() {
  return <i>static</i>;
}

// a: forwarded through a destructured local and a const alias. b: unused.
function Aliased(props: { a: string; b: string }) {
  const { a } = props;
  const copy = a;

  return <Leaf value={copy} />;
}

// flag: condition. x: forwarded on one branch.
function Branchy({ flag, x }: { flag: boolean; x: string }) {
  return flag ? <Leaf value={x} /> : null;
}

// value: replaced by the later attribute, so never delivered. extra: forwarded, then unused.
function SpreadFirst(props: { value: string; extra: string }) {
  return <Leaf {...props} value="fixed" />;
}

// value: delivered by the spread, which comes last.
function SpreadLast(props: { value?: string }) {
  return <Leaf value="fixed" {...props} />;
}

// Every prop other than label lands on a DOM element.
function HostRest({ label, ...rest }: { label: string; title?: string }) {
  return <button {...rest}>{label}</button>;
}

// user: unknown, because the inner binding is not followed.
function Nested({ user: { name } }: { user: { name: string } }) {
  return <b>{name}</b>;
}

// Any prop: unknown, because the name is computed.
function Dynamic(props: Record<string, string>) {
  const name = 'a';

  return <b>{props[name]}</b>;
}

// onReady: called in an effect. id: passed along in the effect and listed as a dependency.
function Effecty({ onReady, id }: { onReady: (id: string) => void; id: string }) {
  useEffect(() => {
    onReady(id);
  }, [id, onReady]);

  return null;
}

// onSave: called from a named handler that only runs on click.
function NamedHandler({ onSave, doc }: { onSave: (doc: string) => void; doc: string }) {
  function handle() {
    onSave(doc);
  }

  return <button onClick={handle}>Save</button>;
}

function Shell({ children, title }: { children: React.ReactNode; title: string }) {
  return <section title={title}>{children}</section>;
}

// item: forwarded to Leaf by this component, although Shell renders the element.
function Composed({ item }: { item: string }) {
  return (
    <Shell title="Composed">
      <Leaf value={item} />
    </Shell>
  );
}

// tag: forwarded to itself. Recursive paths stay unresolved.
function Tree({ depth, tag }: { depth: number; tag: string }): React.ReactNode {
  return depth > 0 ? <Tree depth={depth - 1} tag={tag} /> : null;
}

// v: unknown, the receiver has no source.
function UsesExternal({ v }: { v: string }) {
  return <External v={v} />;
}

// Icon: rendered as a component.
function Slot({ Icon }: { Icon: () => React.ReactNode }) {
  return <Icon />;
}

// onClick: handed straight to the DOM.
function DirectHandler({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick}>Go</button>;
}

class Legacy extends Component<{ v: string }> {
  render() {
    return null;
  }
}

// v: unknown, class components are not analyzed.
function UsesClass({ v }: { v: string }) {
  return <Legacy v={v} />;
}

// a: forwarded on a condition. on: condition.
function Conditional({ a, on }: { a: string; on: boolean }) {
  return <Leaf value={on ? a : undefined} />;
}

// a: derived, because a fallback may replace it.
function Fallback({ a }: { a?: string }) {
  return <Leaf value={a ?? 'none'} />;
}

// a: derived into a context value, whose readers are not followed.
function Provides({ a }: { a: string }) {
  return (
    <Theme.Provider value={{ a }}>
      <Ignorer />
    </Theme.Provider>
  );
}

// Default memo does not read props; a custom comparator does.
const PlainMemo = memo(function PlainMemo({ shown }: { shown: string; ignored: string }) {
  return <i>{shown}</i>;
});
const Compared = memo(
  function Compared({ shown }: { shown: string; ignored: string }) {
    return <i>{shown}</i>;
  },
  (before, after) => before.ignored === after.ignored,
);

// seed: reaches a hook. The hook is not followed, so this counts as a use.
function Hooked({ seed, unused }: { seed: string; unused: string }) {
  useEffect(() => {}, [seed]);

  return null;
}

// label: reassigned locals are not aliases, so this is a use and a derived value.
function Reassigned({ label }: { label: string }) {
  let text = label;

  text = text.trim();

  return <Leaf value={text} />;
}

// label: unknown. Props are reachable through `arguments` without a parameter.
function ArgumentsReader() {
  return <p>{arguments[0].label}</p>;
}

// label: unknown. Direct eval can read anything in scope.
function EvalReader(props: { label: string }) {
  return <p>{eval('props.label')}</p>;
}

// A nested function's own `arguments` is not the component's props.
function NestedArguments({ label }: { label: string; unused: string }) {
  function count() {
    return arguments.length;
  }

  return <p>{label + count()}</p>;
}

function areEqual(before: { shown: string }, after: { shown: string }) {
  return before.shown === after.shown;
}

function Listed({ shown }: { shown: string; ignored: string }) {
  return <i>{shown}</i>;
}

// The comparator is named, and reached through an alias.
const ListedMemo = memo(Listed, areEqual);
const ListedAlias = ListedMemo;

// label on <Tab>: unknown. Tabs reads it from the child element; Tab never does.
function Tabs({ children }: { children: React.ReactNode }) {
  return (
    <ul>
      {Children.map(children, (child) =>
        isValidElement<{ label: string }>(child) ? <li>{child.props.label}</li> : null,
      )}
    </ul>
  );
}

function Tab({ title }: { label: string; title: string }) {
  return <b>{title}</b>;
}

let registered = 0;

// old: unknown. Passing it stops the default from running. plain: unused.
function Defaults({ old = ++registered, plain = 'x' }: { old?: number; plain?: string }) {
  return <i>static</i>;
}

// An element kept in a variable can be read by the code that holds it.
function Held({ item }: { item: string }) {
  const element = <Leaf value="v" extra={item} />;

  return <div>{element}</div>;
}

function Reads({ caption }: { caption: string }) {
  return <b>{caption}</b>;
}

function Replaced(_props: { caption: string }) {
  return <i>static</i>;
}

// caption: unknown for all three. Each name can hold another component by the
// time it renders, so its declaration says nothing about the receiver.
let Swapped: (props: { caption: string }) => React.ReactNode = Replaced;

Swapped = Reads;

// oxlint-disable-next-line prefer-const -- A `let` binding is the case under test.
let LetBound = Replaced;

// @ts-expect-error -- A function declaration is still a writable binding.
Replaced = Reads;

// caption: unknown. Props arrive at args[0].
function RestReader(...args: [{ caption: string }]) {
  return <b>{args[0].caption}</b>;
}

// label: unknown. After the write, `label` is not the prop.
function Rebound({ label, other }: { label: string; other: string }) {
  label = other;

  return <Leaf value={label} />;
}

function WithThis(this: void, props: { status: string; ignored: number }) {
  return <span>{props.status}</span>;
}

function render(child: React.ReactElement<{ status: string }>) {
  void child.props.status;
  return child;
}

function makeElement() {
  return <WithThis status="from helper" ignored={4} />;
}

export function ViaLocalRoot() {
  const root = createRoot(document.body);
  root.render(<WithThis status="root" ignored={1} />);
}
export function ViaReplacedMethod() {
  const root = createRoot(document.body);
  root.render = () => {};
  root.render(<WithThis status="replaced" ignored={1} />);
}
export function ViaPortal() {
  return portal(<WithThis status="portal" ignored={1} />, document.body);
}

export function ViaHelper() {
  const element = makeElement();
  void element.props.ignored;
  return element;
}

export function ViaUserRenderer() {
  return render(<WithThis status="held" ignored={2} />);
}

function InputRenderer({ label }: { label: string }, ref: React.ForwardedRef<HTMLInputElement>) {
  return <input aria-label={label} ref={ref} />;
}
const WrappedInput = memo(forwardRef(InputRenderer));
const InlineRef = forwardRef<HTMLInputElement>((_props, ref) => <input ref={ref} />);

function LiteralSpread({ value, item }: { value: string; item: string }) {
  const attributes = { value: item, extra: item.toUpperCase() };
  return (
    <>
      <Leaf {...{ value, extra: item }} />
      <Leaf {...attributes} />
    </>
  );
}

export function Controls({ run }: { run: () => void }) {
  return (
    <>
      <WrappedInput label="Name" ref={null} />
      <InlineRef ref={null} />
      <LiteralSpread value="from caller" item="renamed" />
      <Aliased a="a" b="b" />
      <Branchy flag x="x" />
      <SpreadFirst value="v" extra="e" />
      <SpreadLast value="v" />
      <HostRest label="l" title="t" />
      <Nested user={{ name: 'n' }} />
      <Dynamic a="a" />
      <Effecty onReady={run} id="i" />
      <NamedHandler onSave={run} doc="d" />
      <Composed item="i" />
      <Tree depth={2} tag="t" />
      <UsesExternal v="v" />
      <Slot Icon={Ignorer} />
      <DirectHandler onClick={run} />
      <UsesClass v="v" />
      <Conditional a="a" on />
      <Fallback a="a" />
      <Provides a="a" />
      <PlainMemo shown="s" ignored="i" />
      <Compared shown="s" ignored="i" />
      <Hooked seed="s" unused="u" />
      <Reassigned label="l" />
      <ArgumentsReader {...({ label: 'l' } as object)} />
      <EvalReader label="l" />
      <NestedArguments label="l" unused="u" />
      <ListedAlias shown="s" ignored="i" />
      <Listed shown="s" ignored="i" />
      <Tabs>
        <Tab label="l" title="t" />
      </Tabs>
      <Defaults old={1} plain="p" />
      <Held item="i" />
      <Swapped caption="c" />
      <LetBound caption="c" />
      <Replaced caption="c" />
      <RestReader caption="c" />
      <Rebound label="l" other="o" />
      <WithThis {...{ status: 'open', ignored: 2 }} />
      <Ignorer />
    </>
  );
}
