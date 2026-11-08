/**
 * Build the publishable package:
 *   dist/cli.js      single-file bundle (server + hono/nanoid/dotenv), run with Bun
 *   dist/dashboard/  copy of the built dashboard, served by `abbacchio` in production
 *
 * The dashboard is optional: without packages/dashboard/dist the API still
 * builds and works; it just serves a placeholder page at "/".
 */
import { cpSync, existsSync, rmSync } from 'fs';
import { join } from 'path';

const root = join(import.meta.dir, '..');
const outdir = join(root, 'dist');
const dashboardDist = join(root, '../dashboard/dist');
const pkg = await Bun.file(join(root, 'package.json')).json();

rmSync(outdir, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [join(root, 'src/cli.ts')],
  outdir,
  target: 'bun',
  define: {
    ABBACCHIO_VERSION: JSON.stringify(pkg.version),
    // Bun.build inlines process.env.NODE_ENV ("development") by default, which
    // would freeze the server in dev mode: no dashboard, no production API_KEY
    // requirement, SQL endpoint always on. Keep it a runtime lookup.
    'process.env.NODE_ENV': 'globalThis.process.env.NODE_ENV',
  },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

if (existsSync(join(dashboardDist, 'index.html'))) {
  cpSync(dashboardDist, join(outdir, 'dashboard'), { recursive: true });
  console.log('Bundled dashboard into dist/dashboard');
} else {
  console.warn('packages/dashboard/dist not found; building without the dashboard (run the dashboard build first to include it)');
}

for (const output of result.outputs) {
  console.log(`${output.path.replace(root + '/', '')}  ${(output.size / 1024).toFixed(1)} KB`);
}
