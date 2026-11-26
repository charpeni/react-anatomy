import { jsx } from 'react/jsx-runtime';

function RelayTarget(props: { note: string }) {
  return jsx('p', { className: 'note', children: props.note });
}

// Hands its own props object to another component without copying it. React
// then holds the same object for both, so the inner component must not inherit
// the call-site record of the element that created the outer one.
export function Relay(props: { note: string }) {
  return jsx(RelayTarget, props);
}
