export interface Plan {
  id: string;
  name: string;
  price: number;
  seats: number;
  trial: boolean;
}

export const plans: Plan[] = [
  { id: 'team', name: 'Team', price: 12, seats: 10, trial: true },
  { id: 'business', name: 'Business', price: 29, seats: 50, trial: false },
];

export interface Member {
  id: string;
  profile: { name: string; role: string };
}

export const members: Member[] = [
  { id: 'm1', profile: { name: 'Ada Okafor', role: 'Owner' } },
  { id: 'm2', profile: { name: 'Jun Sato', role: 'Billing' } },
];

export const usage = { used: 7, limit: 10, version: 3 };

/** One prop per day: more props than the inspector lists for one component. */
export const history: Record<string, number> = Object.fromEntries(
  Array.from({ length: 240 }, (_, day) => [`day${day}`, 5 + (day % 6)]),
);
