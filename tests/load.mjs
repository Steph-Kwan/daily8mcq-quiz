// Loads the browser scripts into one VM context, the way the page concatenates them.
import fs from 'node:fs';
import vm from 'node:vm';

export const root = new URL('..', import.meta.url).pathname;
export const read = p => fs.readFileSync(root + p);

export function load(files = ['src/vendor/fflate.js', 'src/xlsx.js', 'src/bank.js', 'src/progress.js']) {
  const ctx = vm.createContext({ console, TextEncoder, TextDecoder, Blob, URL, atob, btoa, t: (s, p) => (p ? s.replace(/\{(\w+)\}/g, (m, k) => (k in p ? String(p[k]) : m)) : s) });
  ctx.window = ctx; ctx.self = ctx;
  for (const f of files) vm.runInContext(fs.readFileSync(root + f, 'utf8'), ctx, { filename: f });
  // Top-level const/let/class are not context properties; expose what the tests need.
  return vm.runInContext('({ fflate, readXlsx, readCsv, buildBank, parseQuestionRows, analyze, dueToday, reviewForecast, categoryStats, studyStreak, pickQuestions, emptyProgress, normalizeProgress, startOfDay, DAY: 864e5 })', ctx);
}
