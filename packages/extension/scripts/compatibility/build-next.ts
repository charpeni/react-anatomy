import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const child = spawn(
  process.execPath,
  [resolve('validation/node_modules/next/dist/bin/next'), 'build', '--webpack'],
  {
    cwd: resolve('validation/next-app'),
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', ANATOMY_NEXT_DEV: '0' },
    stdio: 'inherit',
  },
);

child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
