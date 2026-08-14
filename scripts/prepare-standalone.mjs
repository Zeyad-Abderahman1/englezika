import { cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const standalone = resolve(root, '.next', 'standalone');

await mkdir(resolve(standalone, '.next'), { recursive: true });
await Promise.all([
  cp(resolve(root, '.next', 'static'), resolve(standalone, '.next', 'static'), {
    recursive: true,
    force: true,
  }),
  cp(resolve(root, 'public'), resolve(standalone, 'public'), {
    recursive: true,
    force: true,
  }),
]);

process.stdout.write('Copied public and .next/static assets into the standalone bundle.\n');
