// Lists every UI string passed to t() / toast() / uiConfirm(), plus labels in tables that are translated later. Used by the i18n test.
import fs from 'node:fs';
const files = ['src/platform.js', 'src/bank.js', 'src/progress.js', 'src/ai.js', 'src/app.js'];
const found = new Set();
for (const f of files) {
  const src = fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  for (const m of src.matchAll(/\b(?:t|toast|uiConfirm)\(\s*'((?:[^'\\]|\\.)*)'/g)) found.add(m[1].replace(/\\'/g, "'"));
  // Strings later passed through t() indirectly: nav labels, type labels, model notes, format help, tab labels, ok-button labels.
  for (const m of src.matchAll(/\[\s*'[a-z]+'\s*,\s*'[^']*'\s*,\s*'([^']*[一-鿿][^']*)'/g)) found.add(m[1]);
  for (const m of src.matchAll(/\[\s*'[a-z]+'\s*,\s*'([^']*[一-鿿][^']*)'\s*\]/g)) found.add(m[1]);
  for (const m of src.matchAll(/\[\s*'([^']*[一-鿿][^']*)'\s*,\s*'([^']*[一-鿿][^']*)'\s*\]/g)) { found.add(m[1]); found.add(m[2]); }
  for (const m of src.matchAll(/note: '([^']+)'/g)) found.add(m[1]);
  for (const m of src.matchAll(/(?:single|multiple|truefalse): '([^']*[一-鿿][^']*)'/g)) found.add(m[1]);
  for (const m of src.matchAll(/ok: '([^']+)'/g)) found.add(m[1]);
  for (const m of src.matchAll(/\[\s*'[^']*'\s*,\s*'([^']*[\u4e00-\u9fff][^']*)'\s*\]/g)) found.add(m[1]);
}
for (const s of ['取消', '继续']) found.add(s);
export const strings = [...found].filter(s => /[一-鿿]/.test(s)).sort();
if (process.argv[1] === new URL(import.meta.url).pathname) console.log(JSON.stringify(strings, null, 1));
