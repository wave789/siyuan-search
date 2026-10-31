import { build, context } from 'esbuild';
import { mkdir, cp, writeFile, readFile, rm } from 'node:fs/promises';
const worker = await build({ entryPoints: ['src/search/worker.ts'], bundle: true, write: false, format: 'iife', target: 'es2022', minify: true });
const manifest = JSON.parse(await readFile('plugin.json', 'utf8'));
// Rebuild generated files from scratch so deleted resources cannot linger in a release.
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
const resources = new Set(['plugin.json', 'VALIDATION.md', 'LICENSE', 'CHANGELOG.md', 'i18n', 'icon.svg', 'assets',
  ...Object.values(manifest.readme), ...[manifest.icon, manifest.preview].filter(Boolean)]);
for (const name of resources) {
  await cp(name, `dist/${name}`, { recursive: true });
}
// SiYuan loads the CommonJS entry without a package.json. Keep the dist folder CommonJS.
const options = {
  entryPoints: ['src/index.ts'], outfile: 'dist/index.js', bundle: true,
  format: 'cjs', platform: 'browser', target: 'es2022', external: ['siyuan'],
  define: { __SEARCH_WORKER_SOURCE__: JSON.stringify(worker.outputFiles[0].text) },
  sourcemap: true, minify: !process.argv.includes('--watch'), logLevel: 'info',
};
if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('Watching src/. Copy dist/ into the workspace plugins/siyuan-search directory.');
} else {
  await build(options);
  await writeFile('dist/.build-info', `${manifest.name} ${manifest.version}\n`);
}
