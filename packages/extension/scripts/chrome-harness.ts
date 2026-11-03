import type { BrowserType } from 'playwright';
import type { ProtocolMapping } from 'devtools-protocol/types/protocol-mapping.js';
import type { AddressInfo } from 'node:net';

type Commands = ProtocolMapping.Commands;
type CdpEvent = {
  [Method in keyof ProtocolMapping.Events]: {
    method: Method;
    params: ProtocolMapping.Events[Method][0];
    sessionId?: string;
  };
}[keyof ProtocolMapping.Events];
type PendingCommand = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
type LaunchOptions = {
  extension?: string;
  autoDevtools?: boolean;
  recordVideo?: NonNullable<Parameters<BrowserType['launchPersistentContext']>[1]>['recordVideo'];
  deviceScaleFactor?: number;
};

import { chromium } from 'playwright';
import { browserOptions } from './browser-options.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';

export async function launchExtension({
  extension = resolve('dist/extension'),
  autoDevtools = true,
  recordVideo,
  deviceScaleFactor = 1,
}: LaunchOptions = {}) {
  const server = createServer();

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

  const port = (server.address() as AddressInfo).port;

  await new Promise((r) => server.close(r));

  const profile = await mkdtemp(join(tmpdir(), 'react-anatomy-chrome-'));
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    ...browserOptions(),
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor,
    recordVideo,
    args: [
      // DevTools extension frames do not inherit Playwright's page emulation.
      ...(deviceScaleFactor !== 1 ? [`--force-device-scale-factor=${deviceScaleFactor}`] : []),
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      `--remote-debugging-port=${port}`,
      ...(autoDevtools ? ['--auto-open-devtools-for-tabs'] : []),
    ],
  });
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  const { webSocketDebuggerUrl } = (await (
    await fetch(`http://127.0.0.1:${port}/json/version`)
  ).json()) as { webSocketDebuggerUrl: string };
  const socket = new WebSocket(webSocketDebuggerUrl);

  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });

  let nextId = 0;
  const pending = new Map<number, PendingCommand>();
  const listeners = new Set<(event: CdpEvent) => void>();

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const p = pending.get(message.id);

    if (p) {
      pending.delete(message.id);
      clearTimeout(p.timer);
      message.error ? p.reject(new Error(message.error.message)) : p.resolve(message.result);
    } else if (message.method) {
      for (const listener of listeners) {
        listener(message);
      }
    }
  });

  const send = <Method extends keyof Commands>(
    method: Method,
    params = {} as Commands[Method]['paramsType'][0],
    sessionId?: string,
  ) =>
    new Promise<Commands[Method]['returnType']>((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 20000);

      pending.set(id, {
        resolve: (result) => resolve(result as Commands[Method]['returnType']),
        reject,
        timer,
      });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

  const attach = async (id: string) =>
    (await send('Target.attachToTarget', { targetId: id, flatten: true })).sessionId;

  const evaluate = async <Result = unknown>(
    expression: string,
    sessionId: string,
  ): Promise<Result> => {
    const response = await send(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
      sessionId,
    );

    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description || response.exceptionDetails.text,
      );
    }

    return response.result?.value as Result;
  };

  const until = async <T>(
    fn: () => T | Promise<T>,
    message: string,
    timeout = 15000,
  ): Promise<Exclude<T, null | undefined | false>> => {
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const value = await fn();

      if (value) {
        return value as Exclude<T, null | undefined | false>;
      }

      await new Promise((r) => setTimeout(r, 200));
    }

    throw new Error(message);
  };

  return {
    context,
    worker,
    send,
    attach,
    evaluate,
    until,
    onEvent: (listener: (event: CdpEvent) => void) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    extensionId: worker.url().split('/')[2],
    close: async () => {
      socket.close();
      await context.close();
      await rm(profile, { recursive: true, force: true });
    },
  };
}

export async function openDevtoolsPanel(harness: Awaited<ReturnType<typeof launchExtension>>) {
  const { send, attach, evaluate, until } = harness;
  const target = await until(
    async () =>
      (await send('Target.getTargets')).targetInfos.find((t) => t.url.startsWith('devtools://')),
    'DevTools did not open',
  );
  const session = await attach(target.targetId);

  await until(
    async () =>
      evaluate(
        `(async()=>{
    const UI=await import('devtools://devtools/bundled/ui/legacy/legacy.js');
    let manager;
    try { manager=UI.ViewManager.ViewManager.instance(); }
    catch(error) { if(/settings|local storage|locale/i.test(error.message))return false;throw error; }
    const views=manager.views.values();
    const view=Array.from(views).find(v=>{try{return v.title()==='Anatomy';}catch{return false;}});
    if(!view)return false;
    await manager.showView(view.viewId());return true;
  })()`,
        session,
      ),
    'The Anatomy DevTools panel was not registered',
  );

  const panel = await until(
    async () =>
      (await send('Target.getTargets')).targetInfos.find((t) => t.url.endsWith('/panel.html')),
    'The React Anatomy panel frame did not open',
  );
  const panelSession = await attach(panel.targetId);

  await evaluate(
    `(async()=>{const UI=await import('devtools://devtools/bundled/ui/legacy/legacy.js');UI.DockController.DockController.instance().setDockSide('undocked');})()`,
    session,
  );

  return { session, panelSession };
}
