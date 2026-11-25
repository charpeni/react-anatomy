// Renders what it is given. If it ever read `children.props`, every element
// passed to it would have a reader that the element's own component lacks.
export function Slot({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}
