import { Ignored } from './both.tsx';
import { Slot } from './Slot.tsx';
import { Card } from './star.ts';

// `Card` reaches Ignored through two re-exporting modules. The element inside
// Slot is handed to another component before it is rendered.
export function App() {
  return (
    <>
      <Card caption="onscreen" />
      <Slot>
        <Ignored caption="in a slot" />
      </Slot>
    </>
  );
}
