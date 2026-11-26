import type { Ticket } from './data.ts';

interface RowProps {
  ticket: Ticket;
  onDismiss: (id: string) => void;
  density: 'comfortable' | 'compact';
  auditTag: string;
  dueLabel: string;
  ownerName: string;
}

// `auditTag` is passed by the queue but is not destructured here, and there is
// no rest element that could carry it anywhere.
export function TicketRow({ ticket, onDismiss, density, dueLabel, ownerName }: RowProps) {
  return (
    <article className={ticket.resolved ? 'ticket resolved' : 'ticket'}>
      <PriorityBadge level={ticket.priority} legacyColor="amber" />
      <div className="ticket-body">
        <strong>{ticket.subject}</strong>
        <TicketMeta density={density} updated={ticket.updated} owner={ownerName} due={dueLabel} />
      </div>
      <button disabled={ticket.resolved} onClick={() => onDismiss(ticket.id)}>
        Resolve
      </button>
    </article>
  );
}

// Reads one prop from its props object and ignores `legacyColor`.
function PriorityBadge(props: { level: Ticket['priority']; legacyColor: string }) {
  return <span className={'priority ' + props.level}>{props.level}</span>;
}

// The end of the `density` chain: it is received here and never read.
function TicketMeta({
  updated,
  owner,
  due,
}: {
  density: string;
  updated: string;
  owner: string;
  due: string;
}) {
  return (
    <span className="ticket-meta">
      {owner} · {due} · updated {updated}
    </span>
  );
}
