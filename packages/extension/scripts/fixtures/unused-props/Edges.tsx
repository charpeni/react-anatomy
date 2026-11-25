import type { ComponentType, FunctionComponent } from 'react';
import type { Member } from './data.ts';

interface InvoiceProps {
  amount: number;
  currency: string;
}

function useInvoiceTotal(input: InvoiceProps) {
  return new Intl.NumberFormat('en', { style: 'currency', currency: input.currency }).format(
    input.amount,
  );
}

// The props object leaves this component, so any prop may be read elsewhere.
export function InvoiceSummary(props: InvoiceProps) {
  const total = useInvoiceTotal(props);

  return <p className="invoice">Next invoice: {total}</p>;
}

// Declares no parameter and reads the props through `arguments`.
export const LegacyTotal: FunctionComponent<InvoiceProps> = function LegacyTotal() {
  // eslint-disable-next-line prefer-rest-params
  const props = arguments[0] as InvoiceProps;

  return (
    <p className="invoice">
      Last invoice: {props.amount} {props.currency}
    </p>
  );
};

// The nested pattern is a boundary for `member`; `size` is simply not named.
export function MemberChip({
  member: {
    profile: { name },
  },
}: {
  member: Member;
  size: string;
}) {
  return <span className="chip">{name}</span>;
}

function withTracking<Props extends object>(Inner: ComponentType<Props>) {
  return function Tracked(props: Props) {
    return <Inner {...props} />;
  };
}

function Footer({ note }: { note: string; campaign: string }) {
  return <small className="footer">{note}</small>;
}

export const TrackedFooter = withTracking(Footer);

export function PlanLink({ href }: { href: string; tone: string }) {
  return (
    <a className="plan-link" href={href}>
      Compare plans
    </a>
  );
}
