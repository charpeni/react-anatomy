import { Suspense } from 'react';
import Review from './review.tsx';

export const dynamic = 'force-dynamic';

async function ServerOnlyHeading() {
  await new Promise((resolve) => setTimeout(resolve, 100));
  return <h1 data-check="server-heading">Server-rendered review</h1>;
}
export default function Page() {
  return (
    <>
      <Suspense fallback={<p>Loading heading…</p>}>
        <ServerOnlyHeading />
      </Suspense>
      <Review
        issue={{
          id: 42,
          title: 'Review the streamed layout',
          owner: { name: 'Nicolas', team: 'Engineering' },
        }}
      />
    </>
  );
}
