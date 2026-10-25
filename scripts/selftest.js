// Runs inside the macOS app (scripts/test_mac.sh). Phase "write" exercises the app; "read" checks what survived a relaunch.
const wait = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 100 && !bank; i++) await wait(100);
const phase = appStore.get('selftest-phase') || 'write';
const out = { phase, native: appStore.native, language: interfaceLanguage, languages: window.__DAILY8_NATIVE__.languages };

if (phase === 'write') {
  out.demo = { title: bank.title, questions: bank.questions.length, isDemo: !!bank.demo };
  const names = [...new Set(bank.questions.flatMap(q => [...q.images, ...q.options.map(o => o.image).filter(Boolean)]))];
  out.images = { total: names.length, failed: 0 };
  for (const n of names) {
    try {
      const img = new Image(); img.src = await imageURL(n);
      await img.decode();
      if (!img.naturalWidth) out.images.failed++;
    } catch { out.images.failed++; }
  }

  // Import a second bank through the same path as the file picker.
  const csvText = '题目,A,B,C,答案,分类\n自检题一,甲,乙,丙,B,自检\n自检题二,甲,乙,丙,AC,自检\n';
  await readImport([new File([csvText], 'selftest.csv')]);
  out.preview = pendingImport && { questions: pendingImport.bank.questions.length, errors: pendingImport.errors.length };
  await confirmImport();
  out.afterImport = { current: bank.title, banks: banks.length };
  await openBank(banks.find(b => b.demo).id);

  // Play one session: answer everything "A", submit.
  await start(pickQuestions(practicable(), 8, analysis, true));
  for (const id of progress.draft.ids) { pos = progress.draft.ids.indexOf(id); choose(byId(id), 'A'); }
  submit();
  out.session = { view, history: progress.history.length, wrong: Object.keys(analysis.wrong).length, inReview: Object.keys(analysis.review).length };

  // In-page dialog.
  const pending = uiConfirm('开始新一轮会替换未完成的练习，是否继续？');
  out.dialog = !!document.querySelector('.dialog-backdrop');
  document.querySelector('[data-dialog=cancel]').click();
  out.dialogResult = await pending;

  // The SDK runs inside WebKit: an invalid key must come back as a clear authentication error, also with an image attached.
  appSecrets.set(API_KEY_SECRET, 'sk-ant-selftest-invalid');
  try { await testAiConnection(); out.aiTest = 'unexpected success'; } catch (e) { out.aiTest = e.message; }
  const imageQuestion = bank.questions.find(q => q.images.length);
  try { await explainMistake(imageQuestion, 'A', {}); out.aiExplain = 'unexpected success'; } catch (e) { out.aiExplain = e.message; }
  out.imageBlock = (await imageBlock(await bankStore.asset(bank.id, imageQuestion.images[0]))).source.media_type;

  // Markdown from the model is rendered without executing HTML.
  out.markdownSafe = !renderMarkdown('<img src=x onerror=alert(1)> **ok**').includes('<img');
  appStore.set('selftest-phase', 'read');
} else if (phase === 'read') {
  out.banks = banks.map(b => b.title).sort();
  out.current = bank.title;
  out.history = progress.history.length;
  out.keychain = appSecrets.get(API_KEY_SECRET) === 'sk-ant-selftest-invalid';
  // Clean up: remove the key, the imported bank and the database.
  appSecrets.set(API_KEY_SECRET, '');
  for (const b of banks.filter(b => !b.demo)) await bankStore.remove(b.id);
  (await openDb()).close();
  await new Promise(r => { const q = indexedDB.deleteDatabase('daily8'); q.onsuccess = q.onerror = q.onblocked = r; });
  appStore.set('selftest-phase', 'done');
}
return JSON.stringify(out);
