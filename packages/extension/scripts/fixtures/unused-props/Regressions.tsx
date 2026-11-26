import type { ReactNode, Ref } from 'react';
import {
  Children,
  cloneElement,
  createContext,
  createElement,
  forwardRef,
  isValidElement,
  memo,
  useMemo,
} from 'react';

// Analyzed by scripts/check-unused-props.ts and never bundled. Each component
// is one way a prop can look unused without being unused, or the reverse.
// Bindings that nothing reads are the subject of the file.
/* oxlint-disable no-unused-vars */

interface BoxProps {
  tone?: string;
  size?: number;
  label?: string;
  children?: ReactNode;
}

// Reads through `arguments` although it also destructures a parameter.
function ArgumentsWithPattern({ label }: BoxProps) {
  // eslint-disable-next-line prefer-rest-params
  const all = arguments[0] as BoxProps;

  return (
    <p>
      {label}
      {all.size}
    </p>
  );
}

function EvalReader(props: BoxProps) {
  void props;

  // eslint-disable-next-line no-eval
  return <p>{eval('props.tone')}</p>;
}

// `size` is read only as the default of another prop.
function DefaultReader({ size, width = size }: BoxProps & { width?: number }) {
  return <p style={{ width }}>sized</p>;
}

// Destructured in the body instead of the parameter list.
function BodyDestructure(props: BoxProps) {
  const { tone } = props;

  return <p className={tone}>body</p>;
}

// A const alias that nothing reads does not count as a read.
function DeadAlias({ tone, label }: BoxProps) {
  const unusedTone = tone;

  return <p>{label}</p>;
}

// An inner function shadows the prop name with its own parameter.
function Shadowed({ tone, label }: BoxProps) {
  const format = (tone: string) => tone.toUpperCase();

  return <p>{format(label ?? '')}</p>;
}

// Read only inside a memoized computation, during render.
function Memoized({ size, label }: BoxProps) {
  const area = useMemo(() => (size ?? 0) * 2, [size]);

  return (
    <p>
      {label}
      {area}
    </p>
  );
}

const ToneContext = createContext('plain');

// Handed to a context provider: any descendant may read it.
function Provides({ tone, children }: BoxProps) {
  return <ToneContext.Provider value={tone ?? 'plain'}>{children}</ToneContext.Provider>;
}

// The whole props object goes to createElement.
function Reflects(props: BoxProps) {
  return createElement('p', props);
}

// Children are cloned with an extra prop. `tone` is read into the clone.
function Clones({ tone, children }: BoxProps & { children: React.ReactElement }) {
  return cloneElement(children, { tone } as object);
}

// Children called as a function.
function RenderProp({ children, size }: { children: (size: number) => ReactNode; size: number }) {
  return <div>{children(size)}</div>;
}

const WithRef = forwardRef(function WithRef({ label }: BoxProps, ref: Ref<HTMLParagraphElement>) {
  return <p ref={ref}>{label}</p>;
});

function Plain({ label }: BoxProps & { ref?: Ref<HTMLParagraphElement> }) {
  return <p>{label}</p>;
}

// Reads a prop by a computed name.
function Dynamic(props: BoxProps & { field: 'tone' | 'label' }) {
  return <p>{props[props.field]}</p>;
}

// A compound component: Tabs reads `label` from its child elements.
function Tabs({ children }: { children: ReactNode }) {
  return (
    <ul>
      {Children.map(children, (child) =>
        isValidElement<{ label: string }>(child) ? <li>{child.props.label}</li> : null,
      )}
    </ul>
  );
}

function Tab({ children }: { label: string; children?: ReactNode }) {
  return <section>{children}</section>;
}

// Only renders what it is given, so it cannot have read a child's props.
function Frame({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div>
      {aside}
      {children}
    </div>
  );
}

let registered = 0;

function registerFallback() {
  registered++;

  return 'fallback';
}

// Passing `old` stops registerFallback() from running, although `old` is never read.
function EffectfulDefault({ old = registerFallback(), label }: BoxProps & { old?: string }) {
  return <p>{label}</p>;
}

function LiteralDefault({ tone = 'plain', label }: BoxProps) {
  return <p>{label}</p>;
}

function recordMetric() {
  return ++registered;
}

const shared = { tone: 'calm', size: 3 };

function WithThis(this: void, props: { status: string; legacy: number }) {
  return <span>{props.status}</span>;
}

function render(child: React.ReactElement<{ legacy: number }>) {
  void child.props.legacy;
  return child;
}

function FirstLeaf(_props: BoxProps) {
  return <i />;
}
function OtherLeaf(_props: BoxProps) {
  return <b />;
}
function Middle(props: BoxProps) {
  return <FirstLeaf {...props} />;
}
function FanOut(props: BoxProps) {
  return (
    <>
      <Middle {...props} />
      <OtherLeaf {...props} />
      <OtherLeaf {...props} />
    </>
  );
}
const ComparedRelay = memo(
  function ComparedRelay({ label, ...rest }: BoxProps) {
    return <FirstLeaf label={label} {...rest} />;
  },
  (a, b) => a.label === b.label,
);

export function RegressionHost({ extra }: { extra: object }) {
  // Held in a variable before it is rendered.
  const held = <Plain tone="held" label="n" />;

  return (
    <>
      {held}
      <FanOut tone="warm" />
      <ComparedRelay tone="warm" label="visible" />
      <WithThis {...{ status: 'open', legacy: 2 }} />
      {render(<WithThis status="held" legacy={3} />)}
      <ArgumentsWithPattern label="a" size={1} />
      <EvalReader tone="warm" />
      <DefaultReader size={4} />
      <BodyDestructure tone="warm" size={2} />
      <DeadAlias tone="warm" label="b" />
      <Shadowed tone="warm" label="c" />
      <Memoized size={2} label="d" />
      <Provides tone="warm">
        <p>inside</p>
      </Provides>
      <Reflects tone="warm" />
      <Clones tone="warm">
        <p>cloned</p>
      </Clones>
      <RenderProp size={2}>{(size) => <p>{size}</p>}</RenderProp>
      <WithRef ref={null} label="e" />
      <Plain ref={null} label="f" />
      <Dynamic field="tone" tone="warm" />
      <Tabs>
        <Tab label="Billing">first</Tab>
      </Tabs>
      <Frame aside={<Plain tone="aside" label="h" />}>
        <Plain tone="framed" label="i" />
      </Frame>
      <EffectfulDefault old="skip" label="j" />
      <LiteralDefault tone="warm" label="k" />
      <Plain size={recordMetric()} label="l" />
      {[<Plain key="m" tone="listed" label="m" />]}
      {/* Keys listed from an object literal: delivery is written in source. */}
      <Plain {...shared} label="g" />
      {/* A later spread may replace the attribute. */}
      <Plain tone="warm" {...extra} />
    </>
  );
}
