import { createElement, useState } from 'react';
import { EmptyState, Notice, SeatMeter, StableMeter, UsageHistory } from './Feedback.tsx';
import { CouponField, SaveBar } from './Forms.tsx';
import { InvoiceSummary, LegacyTotal, MemberChip, PlanLink, TrackedFooter } from './Edges.tsx';
import { PlanCard } from './PlanCard.tsx';
import { Toolbar } from './Toolbar.tsx';
import { history, members, plans, usage } from './data.ts';
import { Tooltip } from './vendor/Tooltip.tsx';

// Every element below passes at least one prop that its component does not
// obviously use. Some really are unused; most are the cases an "unused prop"
// check gets wrong. The comment above each element says which.
export function BillingApp() {
  const [selected, setSelected] = useState('team');
  const [coupon, setCoupon] = useState('');
  const [revision, setRevision] = useState(1);
  const dirty = coupon.length > 0;

  return (
    <main className="billing">
      {/* onPrint travels through a rest spread into ToolbarActions, which never reads it. */}
      <Toolbar
        title="Billing"
        onExport={() => setRevision((value) => value + 1)}
        onPrint={() => window.print()}
      />
      <section className="plans">
        {plans.map((plan) => (
          // legacyTheme: unused. trackingId: read only when the button is clicked.
          // compareTo: read in a branch that this render does not take.
          // trialDays: delivered by a conditional spread, so only on some renders.
          <PlanCard
            key={plan.id}
            {...(plan.trial ? { trialDays: 14 } : {})}
            plan={plan}
            selected={plan.id === selected}
            onSelect={setSelected}
            legacyTheme="dark"
            trackingId={'plan-' + plan.id}
            compareTo={plans[0]}
          />
        ))}
      </section>
      {/* dense is destructured only to keep it out of the <input> attributes. */}
      <CouponField label="Coupon" value={coupon} onChange={setCoupon} dense placeholder="SAVE20" />
      {/* revision is never read, but it re-runs an effect when it changes. */}
      <SaveBar dirty={dirty} revision={revision} onReset={() => setCoupon('')} />
      {/* version is read only by a custom memo comparator. */}
      <SeatMeter used={usage.used} limit={usage.limit} version={usage.version} />
      {/* The same comparator, reached through a named function and an alias. */}
      <StableMeter used={usage.used} limit={usage.limit} version={usage.version} />
      {/* 240 props arrive by a spread, so label and legacyScale are past the 200 names the page reports. */}
      <UsageHistory {...history} label="Seat history" legacyScale="log" />
      {/* The children are passed but EmptyState never renders them. */}
      <EmptyState title="No invoices yet">Invoices appear after your first payment.</EmptyState>
      {/* details is read only when kind is "error". */}
      <Notice kind="info" details="Card ending 4242 expires soon." />
      {/* The whole props object goes to a hook, so currency may be read there. */}
      <InvoiceSummary amount={348} currency="EUR" />
      {/* Reads its props through `arguments`. */}
      <LegacyTotal amount={348} currency="EUR" />
      {members.map((member) => (
        // size is unused, but the nested pattern next to it is not followed.
        <MemberChip key={member.id} member={member} size="small" />
      ))}
      {/* Wrapped by a higher-order component that is not followed. */}
      <TrackedFooter note="Prices exclude tax." campaign="spring" />
      {/* Implemented outside the analyzed files. */}
      <Tooltip label="Seats are shared across workspaces" placement="top">
        <span className="hint">What is a seat?</span>
      </Tooltip>
      {/* Created without JSX, so the build recorded no call site for it. */}
      {createElement(PlanLink, { href: '#plans', tone: 'quiet' })}
    </main>
  );
}
