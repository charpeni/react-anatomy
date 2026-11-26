import type { Ticket } from './data.ts';
import { memo } from 'react';
import { chipOptions } from './data.ts';
import { Relay } from './vendor/Relay.ts';
import { Tooltip } from './vendor/Tooltip.tsx';
import { useAuditTrail, withTracking } from './with-tracking.tsx';

// Each component below ends in a boundary the analyzer cannot see past. The
// trace must say "unknown" for these rather than "unused" or "no consumer".
export function Insights({
  tickets,
  revision,
  helpUrl,
}: {
  tickets: Ticket[];
  revision: number;
  helpUrl: string;
}) {
  const first = tickets[0];
  const compact = tickets.length > 2;
  const Note = compact ? CompactNote : FullNote;

  return (
    <aside className="insights" aria-label="Insights">
      <h2>Insights</h2>
      <AssigneeChip {...chipOptions(first)} name={first.owner.name} tone="calm" />
      <Note text={first.subject} emphasis="strong" />
      <TrackedHelpLink href={helpUrl} campaign="desk" />
      <StableSummary total={tickets.length} generatedAt={revision} />
      <AuditFooter revision={revision} source="desk" />
      <Relay note="Relayed without copying props" />
    </aside>
  );
}

// An unresolved spread: `...rest` goes to a component whose source was not analyzed.
function AssigneeChip({ name, ...rest }: { name: string; tone?: string; title?: string }) {
  return (
    <Tooltip {...rest}>
      <span className="chip">{name}</span>
    </Tooltip>
  );
}

// An opaque branch: `Note` is one of these two, chosen while rendering.
function CompactNote({ text }: { text: string; emphasis: string }) {
  return <p className="note compact">{text}</p>;
}

function FullNote({ text, emphasis }: { text: string; emphasis: string }) {
  return <p className={'note ' + emphasis}>{text}</p>;
}

// An unresolved wrapper: HelpLink ignores `campaign`, but the wrapper might not.
function HelpLink({ href }: { href: string; campaign: string }) {
  return (
    <a className="help-link" href={href}>
      Help
    </a>
  );
}

const TrackedHelpLink = withTracking(HelpLink);

// A custom comparator reads props outside the component body.
function Summary({ total }: { total: number; generatedAt: number }) {
  return <p className="summary">{total} tickets in view</p>;
}

const StableSummary = memo(Summary, (before, after) => before.total === after.total);

// An unresolved call: the whole props object is handed to a hook.
function AuditFooter(props: { revision: number; source: string }) {
  const fields = useAuditTrail(props);

  return (
    <p className="audit-footer">
      Revision {props.revision} · {fields} audited fields
    </p>
  );
}
