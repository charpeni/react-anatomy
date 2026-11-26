import type { Plan } from './data.ts';

interface PlanCardProps {
  plan: Plan;
  selected: boolean;
  onSelect: (id: string) => void;
  legacyTheme?: string;
  trackingId: string;
  compareTo?: Plan;
  trialDays?: number;
}

// `legacyTheme` and `trialDays` are declared in the type and passed by the
// caller, but nothing here reads them and there is no rest element.
export function PlanCard({ plan, selected, onSelect, trackingId, compareTo }: PlanCardProps) {
  const choose = () => {
    // The only read of trackingId, and it runs on click, not during render.
    console.log('select', trackingId);
    onSelect(plan.id);
  };

  if (plan.price > 100 && compareTo) {
    return <p className="plan-card">Contact sales (from ${compareTo.price})</p>;
  }

  return (
    <article className={selected ? 'plan-card selected' : 'plan-card'}>
      <h2>{plan.name}</h2>
      <PriceTag amount={plan.price} period="month" locale="en-CA" />
      <button onClick={choose}>{selected ? 'Current plan' : 'Choose'}</button>
    </article>
  );
}

// Takes no props object at all: both `period` and `locale` are dropped,
// but `amount` is read.
function PriceTag(props: { amount: number; period: string; locale: string }) {
  return <p className="price">${props.amount} per seat</p>;
}
