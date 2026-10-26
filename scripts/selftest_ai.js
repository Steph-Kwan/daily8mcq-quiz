// AI round trip against tests/mock_openai.py (scripts/test_mac.sh sets MOCK_URL below before running this).
const wait = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 100 && !bank; i++) await wait(100);
const out = {};
settings.ai = { model: 'mock-ok', baseURL: MOCK_URL, images: true };
appSecrets.set(API_KEY_SECRET, 'sk-mock');
const q = bank.questions.find(x => x.images.length);
const run = async (label, fn) => { try { out[label] = await fn(); } catch (e) { out[label] = 'ERR ' + e.message; } };

await run('models', async () => { const r = await testAiConnection(); return { found: r.found, count: r.ids.length }; });
let partials = 0;
await run('explain', async () => { const r = await explainMistake(q, 'A', { onText: () => partials++ }); return { model: r.model, text: r.text }; });
out.partials = partials;
settings.ai.images = false;
await run('noImages', async () => (await explainMistake(q, 'A', {})).text.match(/images=\d+/)[0]);
settings.ai.images = true;
settings.ai.model = 'mock-length';
await run('length', async () => (await explainMistake(q, 'A', {})).text.slice(-12));
settings.ai.model = 'mock-refusal';
await run('refusal', () => explainMistake(q, 'A', {}));
settings.ai.model = 'mock-slow';
const controller = new AbortController();
setTimeout(() => controller.abort(), 700);
await run('abort', async () => { const r = await explainMistake(q, 'A', { signal: controller.signal }); return 'finished ' + r.text.length; });
settings.ai.model = 'mock-ok';
await run('plan', async () => (await draftReviewPlan('统计数据', {})).text.includes('images=0'));
// The browser path (plain fetch, as on GitHub Pages) against the same server.
await run('browserFetch', async () => {
  const c = new OpenAI({ apiKey: 'sk-mock', baseURL: MOCK_URL, dangerouslyAllowBrowser: true });
  let text = '';
  for await (const ch of await c.chat.completions.create({ model: 'mock-ok', messages: [{ role: 'user', content: 'hi' }], stream: true })) text += ch.choices[0]?.delta?.content || '';
  return text.includes('正确答案');
});
appSecrets.set(API_KEY_SECRET, 'sk-wrong');
await run('wrongKey', () => explainMistake(q, 'A', {}));
appSecrets.set(API_KEY_SECRET, '');
(await openDb()).close();
await new Promise(r => { const d = indexedDB.deleteDatabase('daily8'); d.onsuccess = d.onerror = d.onblocked = r; });
return JSON.stringify(out);
