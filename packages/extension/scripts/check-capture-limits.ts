import assert from 'node:assert/strict';
import type { PageRequests, Snapshot } from '../src/inspector/types.ts';
import { pageAgent } from '../src/inspector/page-agent.ts';
import { launchExtension, openDevtoolsPanel } from './chrome-harness.ts';
import { startFixtureServer } from './fixture-server.ts';
import { nextCaptureBudget, captureLimitMessage } from '../src/inspector/capture-budget.ts';

const budget = {
  components: 2000,
  depth: 300,
  maximum: { components: 5000, depth: 1000 },
  hit: { components: true, depth: false },
};

assert.deepEqual(nextCaptureBudget(budget), { maxComponents: 5000, maxDepth: 300 });
assert.equal(nextCaptureBudget({ ...budget, components: 5000 }), null);
assert.deepEqual(nextCaptureBudget({ ...budget, hit: { components: false, depth: true } }), {
  maxComponents: 2000,
  maxDepth: 600,
});
assert.equal(nextCaptureBudget({ ...budget, components: 5000 }), null);
assert.equal(nextCaptureBudget({ ...budget, hit: { components: false, depth: false } }), null);
assert.match(
  captureLimitMessage({ nodes: Array(2000), limits: budget }),
  /2,000 components captured.*Component limit: 2,000/,
);
console.log('Passed: capture budget progression, maximum, and exact diagnostic wording.');

const fixture = await startFixtureServer();
const harness = await launchExtension();

try {
  const page = harness.context.pages()[0];

  await page.goto(fixture.url + '/deep?large');
  await page.locator('[data-region="card"]').first().waitFor();

  const { panelSession } = await openDevtoolsPanel(harness);

  const evaluate = <T = unknown>(expression: string) =>
    harness.evaluate<T>(expression, panelSession);

  await harness.until(
    () => evaluate(`document.querySelector('.capture-limit-banner')!==null`),
    'Large hierarchy did not report its limit',
  );
  console.log(
    'Initial partial capture:',
    await evaluate(
      `({components:Number(document.querySelector('.tree-scroll')?.getAttribute('data-component-count')),message:document.querySelector('.capture-limit-banner').textContent})`,
    ),
  );
  assert(
    await evaluate(`document.querySelector('[aria-label="Capture more"]')!==null`),
    'Partial captures need a working Capture more action',
  );

  const click = async (label: string) =>
    assert(
      await evaluate(
        `(()=>{const button=document.querySelector('[aria-label="'+${JSON.stringify(label)}+'"]');if(!button)return false;button.click();return true;})()`,
      ),
      `Missing ${label}`,
    );

  await click('Capture more');
  await harness.until(
    () =>
      evaluate(
        `Number(document.querySelector('.tree-scroll')?.getAttribute('data-component-count'))>2900&&!document.querySelector('.capture-limit-banner')`,
      ),
    'Capture more did not complete the large hierarchy',
  );

  const fullCount = await evaluate(
    `Number(document.querySelector('.tree-scroll')?.getAttribute('data-component-count'))`,
  );

  assert.equal(fullCount, 2985);
  // The later sibling stays inspectable in the balanced overview.
  await click('Pick on page');
  await page.locator('[data-region="details"]').click();
  await harness.until(
    () => evaluate(`document.querySelector('.inspector dd')?.textContent.includes('260')`),
    'Later sibling did not become inspectable',
  );

  const selected = await evaluate(
    `document.querySelector('.tree-row.selected [data-tree]').dataset.tree`,
  );

  await click('Capture');
  await harness.until(
    () => evaluate(`document.querySelector('.footer-count').textContent==='Capture 3'`),
    'Manual recapture did not finish',
  );
  assert.equal(
    await evaluate(
      `Number(document.querySelector('.tree-scroll')?.getAttribute('data-component-count'))`,
    ),
    fullCount,
    'Manual capture forgot the increased budget',
  );
  assert.equal(
    await evaluate(`document.querySelector('.tree-row.selected [data-tree]').dataset.tree`),
    selected,
    'Capture more broke stable selection',
  );
  await evaluate(`document.querySelector('.follow-control input').click()`);
  await page.locator('main').evaluate((el) => {
    el.dataset.captureTest = 'changed';
  });
  await harness.until(
    () => evaluate(`document.querySelector('.footer-count').textContent==='Capture 4'`),
    'Follow changes did not recapture',
  );
  assert.equal(
    await evaluate(
      `Number(document.querySelector('.tree-scroll')?.getAttribute('data-component-count'))`,
    ),
    fullCount,
    'Follow changes forgot the increased budget',
  );
  assert.equal(await evaluate(`document.querySelector('.capture-limit-banner')===null`), true);
  await evaluate(`document.querySelector('.follow-control input').click()`);
  console.log(
    'Passed: increase component limit, inspect formerly missing sibling, preserve budget and selection on recapture and follow changes.',
  );
  await page.goto(fixture.url + '/deep?wrappers=360');
  await page.locator('[data-region="card"]').first().waitFor();
  await harness.until(
    () =>
      evaluate(
        `document.querySelector('.capture-limit-banner')?.textContent.includes('300 nested levels')`,
      ),
    'Deep capture did not identify its nesting limit',
  );
  await click('Capture more');
  await harness.until(
    () =>
      evaluate(
        `Number(document.querySelector('.tree-scroll')?.getAttribute('data-component-count'))===454&&!document.querySelector('.capture-limit-banner')`,
      ),
    'Capture more did not recover components below the nesting limit',
  );
  assert.equal(
    await evaluate(`document.querySelectorAll('[data-plane]').length`),
    7,
    'Expanded capture did not reveal the recovered component planes',
  );
  console.log('Passed: nesting-limit diagnosis and deeper capture.');
  await page.goto(fixture.url + '/deep?projects=90');
  await page.locator('[data-region="card"]').first().waitFor();
  await harness.until(
    () =>
      evaluate(
        `Number(document.querySelector('.tree-scroll')?.getAttribute('data-component-count'))===1725`,
      ),
    'Default capture still stops at the old 500-component limit',
  );
  assert.equal(await evaluate(`document.querySelector('.capture-limit-banner')===null`), true);

  // Boundary checks on the same injected page agent, independently of the UI.
  const capture: (request: { action: 'capture' } & PageRequests['capture']) => Snapshot = pageAgent;
  const exact = await page.evaluate(capture, { action: 'capture' as const, maxComponents: 1725 });

  assert.equal(exact.nodes.length, 1725);
  assert.equal(
    exact.truncated,
    false,
    'Exactly the configured count must not falsely report missing components',
  );

  const partial = await page.evaluate(capture, { action: 'capture' as const, maxComponents: 1724 });

  assert.equal(partial.truncated, true);
  assert.equal(partial.limits!.hit.components, true);
  assert.equal(partial.limits!.hit.depth, false);

  const normalized = await page.evaluate(capture, {
    action: 'capture' as const,
    maxComponents: -1,
    maxDepth: Infinity,
  });

  assert.equal(normalized.limits!.components, 2000);
  assert.equal(normalized.limits!.depth, 300);

  const bounded = await page.evaluate(capture, {
    action: 'capture' as const,
    maxComponents: 1000000,
    maxDepth: 1000000,
  });

  assert.equal(bounded.limits!.components, 5000);
  assert.equal(bounded.limits!.depth, 1000);
  console.log(
    'Passed: larger default, exact-limit boundary, distinct limit reasons, invalid inputs and maximum budgets.',
  );
} finally {
  await harness.close();
  await fixture.close();
}
