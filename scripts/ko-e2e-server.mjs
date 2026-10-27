import { spawn } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

if (process.env.VERCEL) throw new Error('Knockout E2E tests require a local environment.');
await mkdir('.tmp', { recursive: true });
const directory = await mkdtemp(path.resolve('.tmp', 'ko-e2e-'));
const child = spawn(
  process.execPath,
  [
    'node_modules/next/dist/bin/next',
    'dev',
    '--webpack',
    '--hostname',
    '127.0.0.1',
    '--port',
    '3117',
  ],
  {
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      DATABASE_URL: '',
      STORAGE_MODE: 'local',
      VALET_LOCAL_DATA_DIR: directory,
      ADMIN_PASSWORD: 'local-e2e-admin-2026',
      DIRECTOR_PASSWORD: 'local-e2e-director-2026',
      SESSION_SECRET: randomBytes(32).toString('hex'),
      NEXT_DIST_DIR: '.next-visual',
    },
  },
);
console.log(`Isolated knockout E2E data: ${directory}`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 1));
