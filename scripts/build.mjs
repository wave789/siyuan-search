import { build, context } from 'esbuild';
import { mkdir, cp, writeFile, readFile } from 'node:fs/promises';
const worker = await build({ entryPoints: ['src/search/worker.ts'], bundle: true, write: false, format: 'iife', target: 'es2022', minify: true });
const manifest = JSON.parse(await readFile('plugin.json', 'utf8'));
await mkdir('dist', { recursive: true });
for (const name of ['plugin.json', 'README.md', 'VALIDATION.md', 'LICENSE', 'i18n', 'icon.png', 'icon.svg']) {
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
