import type {
  ValidationReport,
  ValidationCase,
  CaseResult,
  RuntimeSummary,
  CaptureSummary,
} from './types.ts';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { launchBrowser } from './browser.ts';
import { startApps, startNext } from './servers.ts';

let browser = 'chrome';
let live = false;
let only = '';

for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--browser=')) {
    browser = arg.slice(10);
  } else if (arg === '--public') {
    live = true;
  } else if (arg.startsWith('--only=')) {
    only = arg.slice(7);
  } else {
    throw new Error(`Unknown argument: ${arg}`);
  }
}

const publicCases: ValidationCase[] = [
  {
    id: 'react-dev',
    kind: 'public',
    url: 'https://react.dev/learn',
    selector: 'h1',
    application: 'react.dev',
  },
  {
    id: 'shadcn-dashboard',
    kind: 'public',
    url: 'https://ui.shadcn.com/examples/dashboard',
    selector: 'h1',
    application: 'shadcn/ui',
  },
];
const report: ValidationReport = { startedAt: new Date().toISOString(), browser, cases: [] };
const servers = [];
let h!: Awaited<ReturnType<typeof launchBrowser>>;
let output;

try {
  const appServer = live ? null : await startApps();

  if (appServer) {
    servers.push(appServer);
  }

  let cases: ValidationCase[] = live
    ? publicCases
    : [
        ...JSON.parse(await readFile('artifacts/compatibility/cases.json', 'utf8')).map(
          (item: { id: string }) => ({
            ...item,
            url: appServer!.url + '/' + item.id + '/',
          }),
        ),
        ...['development', 'production'].map((mode) => ({
          id: `next-${mode}`,
          kind: 'next',
          mode,
          application: 'Next.js 16.4.4 App Router',
        })),
      ];

  if (only) {
    cases = cases.filter((item) => item.id.includes(only));
  }

  assert(cases.length, 'No validation cases selected');

  for (const item of cases.filter((item) => item.kind === 'next')) {
    const server = await startNext(item.mode!);

    servers.push(server);
    item.url = server.url + '/';
  }

  h = await launchBrowser(browser);
  report.browserVersion = h.version;
  report.extensionVersion = JSON.parse(await readFile('extension/manifest.json', 'utf8')).version;

  const bundle = await readFile(`dist/${browser === 'firefox' ? 'firefox' : 'extension'}/panel.js`);

  report.panelSha256 = createHash('sha256').update(bundle).digest('hex');
  output = `artifacts/compatibility/results/${browser}-${h.version.replace(/[^a-zA-Z0-9.-]/g, '-')}${live ? '-public' : ''}${only ? '-' + only : ''}`;
  await mkdir(output, { recursive: true });

  let opened = false;

  const run = <T = unknown>(expression: string) => h.panel<T>(expression);

  const click = async (label: string) => {
    // Check and click in one browser evaluation: navigation can start a capture
    // between separate readiness and click calls.
    await h.until(
      () =>
        run(
          `(()=>{const el=[...document.querySelectorAll('button,label')].find(el=>(el.getAttribute('aria-label')||el.textContent.trim())===${JSON.stringify(label)});if(!el||el.disabled)return false;el.click();return true;})()`,
        ),
      `Inspector control never became available: ${label}`,
      30000,
    );
  };

  const props = () => run<string>(`document.querySelector('.props-inspector')?.textContent||''`);

  const capture = async () => {
    await h.until(
      () => run(`document.querySelector('[aria-label="Capture"]')?.disabled===false`),
      'Capture never became available',
    );

    const before = await run(`document.querySelector('.footer-count')?.textContent`);

    await click('Capture');
    await h.until(
      () =>
        run(
          `document.querySelector('[aria-label="Capture"]')?.disabled===false && document.querySelector('.footer-count')?.textContent!==${JSON.stringify(before)}`,
        ),
      'Capture did not finish',
      30000,
    );

    const error = await run(`document.querySelector('[role="alert"]')?.textContent||null`);

    assert(!error, String(error));
  };

  const pick = async (selector: string) => {
    await click('Pick on page');
    await h.clickPage(selector);

    const picked = await h.until(
      () => h.page('window.__REACT_ANATOMY_INSPECTOR_V1__?.picked||null'),
      'The page picker did not record a hit',
    );

    await h.until(
      () =>
        run(
          `document.querySelector('.tree-row.selected .tree-select')?.dataset.tree===${JSON.stringify(picked)}`,
        ),
      'Picker did not select a component',
    );
    await h.until(
      () =>
        run(
          `Boolean(document.querySelector('.props-inspector .section-body'))&&!document.querySelector('.props-inspector .props-loading,.props-inspector [aria-busy="true"]')`,
        ),
      'Picked component props did not load',
    );

    const error = await run(
      `document.querySelector('.props-inspector .props-error')?.textContent||null`,
    );

    assert(!error, String(error));
  };

  for (const item of cases) {
    const result: CaseResult = { ...item, startedAt: new Date().toISOString() };

    console.log(`Checking ${browser} ${h.version}: ${item.id}`);

    const started = Date.now();

    try {
      await h.navigate(item.url!);

      const selector =
        item.kind === 'editor'
          ? '.excalidraw canvas'
          : item.kind === 'public'
            ? item.selector
            : '[data-check="counter"]';

      await h.until(
        () => h.page(`Boolean(document.querySelector(${JSON.stringify(selector)}))`),
        'Application did not become ready',
        60000,
      );
      // SSR text can be visible before hydration. Wait for a committed client
      // root independently of Anatomy; never install a DevTools hook in the app.
      await h.until(
        () =>
          h.page(`(()=>{
        for(const el of document.querySelectorAll('*'))for(const key of Object.keys(el)){
          if(!key.startsWith('__reactFiber$')&&!key.startsWith('__reactContainer$'))continue;
          let fiber=Object.getOwnPropertyDescriptor(el,key)?.value,steps=0;
          while(fiber?.return&&steps++<1000)fiber=fiber.return;
          const root=fiber?.stateNode?.current;
          if(root?.child&&!root.memoizedState?.isDehydrated)return true;
        }
        return false;
      })()`),
        'React did not finish mounting/hydrating',
        60000,
      );
      result.runtime = await h.page<RuntimeSummary>(
        `({react:document.documentElement.dataset.reactVersion||document.querySelector('[data-react-version]')?.dataset.reactVersion||null,next:window.next?.version||null,reactDevtoolsHookPresent:Boolean(window.__REACT_DEVTOOLS_GLOBAL_HOOK__),url:location.href,title:document.title})`,
      );

      if (item.react) {
        assert.equal(result.runtime.react, item.react, 'The app loaded the wrong React version');
      }

      if (!opened) {
        await h.open();
        opened = true;
      }

      await capture();
      result.capture = await run<CaptureSummary>(
        `({components:document.querySelectorAll('.tree-select').length,planes:document.querySelectorAll('[data-plane]').length,partial:document.querySelector('.capture-limit-banner')?.textContent||null,footer:document.querySelector('.extension-footer')?.textContent})`,
      );
      assert(result.capture.components > 5, 'No useful component hierarchy');
      assert(result.capture.planes > 0, 'No visible component planes');

      if (item.kind === 'public' && result.capture.partial) {
        for (let attempt = 0; attempt < 2; attempt++) {
          if (
            !(await run<string>(`Boolean(document.querySelector('[aria-label="Capture more"]'))`))
          ) {
            break;
          }

          const before = await run(`document.querySelector('.footer-count').textContent`);

          await click('Capture more');
          await h.until(
            () =>
              run(
                `document.querySelector('[aria-label="Capture"]')?.disabled===false&&document.querySelector('.footer-count')?.textContent!==${JSON.stringify(before)}`,
              ),
            'Larger capture did not finish',
            45000,
          );
        }

        result.expandedCapture = await run<CaptureSummary>(
          `({components:document.querySelectorAll('.tree-select').length,partial:document.querySelector('.capture-limit-banner')?.textContent||null})`,
        );
        assert(
          result.expandedCapture.components > result.capture.components,
          'Capture more did not recover missing components',
        );
      }

      await click('Explode view');

      if (['router', 'next'].includes(item.kind)) {
        await pick('[data-check="issue"] > h2');
        await h.until(
          async () => (await props()).includes('issue: Object'),
          'Issue component props not selected',
        );
        await run(`document.querySelector('[data-prop-path="props.issue"] summary').click()`);
        await h.until(
          async () => (await props()).includes('owner: Object'),
          'Nested issue props missing',
        );
        await run(`document.querySelector('[data-prop-path="props.issue.owner"] summary').click()`);
        await h.until(
          async () => (await props()).includes('Nicolas'),
          'Nested owner value missing',
        );
        await click('Focus subtree');
        assert(await run<string>(`Boolean(document.querySelector('.focus-navigation'))`));
        await click('Whole page');
        await pick('[data-check="counter"]');
        await h.until(async () => (await props()).includes('count: 0'), 'Counter props missing');
        await h.clickPage('[data-check="counter"]');
        await h.until(
          () =>
            h.page(`document.querySelector('[data-check="counter"]').textContent.includes('1')`),
          'Source app update failed',
        );
        await click('Refresh props');
        await h.until(
          async () => (await props()).includes('count: 1'),
          'Updated committed props missing',
        );
        await click('Follow changes');
        await h.clickPage('[data-check="open"]');
        await h.until(
          () => h.page(`Boolean(document.querySelector('[role="dialog"]'))`),
          'Portal did not open',
        );
        await h.until(
          () =>
            run(
              `document.querySelector('.plane-content') && [...document.querySelectorAll('.plane-content')].some(el=>el.textContent.includes('Close'))`,
            ),
          'Portal did not appear in following capture',
        );
        await pick('[role="dialog"] p');
        await h.until(
          () => run(`document.querySelector('.component-kind')?.textContent.includes('portal')`),
          'Portal ownership missing',
        );
        await h.clickPage('[data-check="close"]');
        await h.clickPage(
          item.kind === 'next' ? '[data-check="details-link"]' : '[data-check="settings-link"]',
        );
        await h.until(
          () => h.page(`Boolean(document.querySelector('[data-check="settings"]'))`),
          'Client routing failed',
        );
        await h.until(
          () =>
            run(
              `document.querySelector('.session')?.textContent.includes(${JSON.stringify(item.kind === 'next' ? '/details' : '/settings')})`,
            ),
          'Inspector did not follow client routing',
        );

        if (await run<string>(`document.querySelector('.follow-control input').checked`)) {
          await click('Follow changes');
        }

        if (item.kind === 'next') {
          assert(
            await run(
              `![...document.querySelectorAll('.node-name')].some(el=>el.textContent==='ServerOnlyHeading')`,
            ),
            'Invented a server-only component',
          );
        }

        result.checks = [
          'capture',
          'layers',
          'pick',
          'nested props',
          'focus',
          'committed props refresh',
          'portal ownership',
          'follow changes',
          'client routing',
        ];
      } else {
        const pickSelector = item.kind === 'editor' ? '.excalidraw button' : item.selector;

        await pick(pickSelector!);
        result.selectedComponent = await run<string>(
          `document.querySelector('.inspector-heading h2')?.textContent`,
        );
        await click('Focus subtree');
        assert(
          await run(`document.querySelectorAll('[data-plane]').length>0`),
          'Focused app region has no visible output',
        );
        result.checks = ['capture', 'layers', 'pick', 'props', 'focus'];
      }

      await run(
        `Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))).then(()=>true)`,
      );
      await h.screenshot(`${output}/${item.id}.png`);
      result.sourceErrors = h.sourceErrors();

      if (!live && result.sourceErrors) {
        assert.deepEqual(result.sourceErrors, [], 'Application threw a browser error');
      }

      result.status = 'passed';
    } catch (error) {
      result.status = 'failed';
      result.error = String(error);

      try {
        await h.screenshot(`${output}/${item.id}-failure.png`);
      } catch {}

      try {
        result.panelDiagnostic = await run<string>(`document.body.textContent.slice(0,2500)`);
      } catch {}

      console.error(item.id, result.error);
    }

    result.elapsedMs = Date.now() - started;
    report.cases.push(result);
    await writeFile(output + '/results.json', JSON.stringify(report, null, 2) + '\n');
  }

  report.finishedAt = new Date().toISOString();
  report.passed = report.cases.every((item) => item.status === 'passed');
  await writeFile(output + '/results.json', JSON.stringify(report, null, 2) + '\n');

  if (!report.passed) {
    process.exitCode = 1;
  }

  console.log(
    `${report.cases.filter((item) => item.status === 'passed').length}/${report.cases.length} passed. ${output}/results.json`,
  );
} finally {
  await h?.close();

  for (const server of servers.reverse()) {
    await server.close();
  }
}
