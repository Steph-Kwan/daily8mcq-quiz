// Bundles the npm dependencies the page uses into self-contained browser scripts in src/vendor/ (committed, so building the site needs no npm).
import { build } from 'esbuild';

const bundles = [
  { file: 'anthropic.js', global: 'Anthropic', source: "export { default } from '@anthropic-ai/sdk';" },
  { file: 'fflate.js', global: 'fflate', source: "export { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';" },
];
for (const b of bundles) {
  await build({
    stdin: { contents: b.source, resolveDir: process.cwd() },
    bundle: true, minify: true, format: 'iife', globalName: b.global, target: 'safari16',
    footer: b.file === 'anthropic.js' ? { js: 'Anthropic=Anthropic.default;' } : undefined,
    legalComments: 'inline', outfile: `src/vendor/${b.file}`,
  });
}
console.log('vendor bundles written');
