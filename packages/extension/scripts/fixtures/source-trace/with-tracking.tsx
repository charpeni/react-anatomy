import type { ComponentType } from 'react';

// A higher-order component. What it does with props depends on code the
// analyzer does not follow, so elements made from its result stay unknown.
export function withTracking<Props extends object>(Inner: ComponentType<Props>) {
  return function Tracked(props: Props) {
    return <Inner {...props} />;
  };
}

export function useAuditTrail(input: object) {
  return Object.keys(input).length;
}
