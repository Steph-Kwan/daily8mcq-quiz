'use strict';
// Daily 8 — pages and interaction. Data: bank.js (banks), progress.js (derived study state), ai.js (AI tutor).

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TYPES = ['single', 'multiple', 'truefalse'];
const SETTINGS_KEY = 'daily8.settings';
const progressKey = id => `daily8.progress.${id}`;
const fmtDate = (ms, opts = { dateStyle: 'medium', timeStyle: 'short' }) => new Date(ms).toLocaleString(interfaceLanguage === 'en' ? 'en-GB' : 'zh-CN', opts);
const pct = x => (x === null || x === undefined ? '—' : Math.round(x * 100) + '%');
const letters = a => [...(a || '')].join(interfaceLanguage === 'en' ? ', ' : '、') || '—';

let settings = { lang: interfaceLanguage, bankId: null, ai: { model: DEFAULT_AI_MODEL, baseURL: '', images: true }, sessionSize: null, preferNew: true };
let banks = [], bank = null, progress = emptyProgress(), analysis = null;
let view = 'home', pos = 0, activeHistory = 0, storageWarning = false;
let filters = { category: 'all', type: 'all', source: 'all' }, wrongFilter = 'active', browse = { query: '', page: 0 };
let pendingImport = null, aiJobs = new Map(), planJob = null, busy = false, aiModelList = [];

// ---- persistence ----

function loadSettings() {
  try { Object.assign(settings, JSON.parse(appStore.get(SETTINGS_KEY) || '{}')); } catch { storageWarning = true; }
  settings.ai = { model: DEFAULT_AI_MODEL, baseURL: '', images: true, ...settings.ai };
}
function saveSettings() { try { appStore.set(SETTINGS_KEY, JSON.stringify(settings)); } catch { storageWarning = true; } }
function saveProgress() {
  try { appStore.set(progressKey(bank.id), JSON.stringify(progress)); }
  catch { storageWarning = true; toast('无法保存学习记录，请到「设置」导出备份。'); }
}
function refresh() { analysis = analyze(bank, progress); }

async function openBank(id) {
  bank = banks.find(b => b.id === id) || banks[0];
  settings.bankId = bank.id; saveSettings();
  try { progress = normalizeProgress(JSON.parse(appStore.get(progressKey(bank.id)) || 'null') || emptyProgress(), bank); }
  catch { progress = emptyProgress(); storageWarning = true; }
  filters = { category: 'all', type: 'all', source: 'all' };
  browse = { query: '', page: 0 };
  releaseImages();
  refresh();
}

async function loadBanks() {
  banks = (await bankStore.list()).sort((a, b) => a.importedAt - b.importedAt);
  if (!banks.length) {
    const demo = buildBank([{ name: 'demo.zip', data: base64ToBytes(window.DAILY8_FILES.demoZip) }]);
    demo.bank.demo = true;
    await bankStore.save(demo.bank, demo.assets);
    banks = [demo.bank];
  }
}

// ---- images (stored in IndexedDB, shown through object URLs) ----

const imageURLs = new Map();
function releaseImages() { for (const url of imageURLs.values()) URL.revokeObjectURL(url); imageURLs.clear(); }
async function imageURL(name) {
  if (imageURLs.has(name)) return imageURLs.get(name);
  const blob = await bankStore.asset(bank.id, name);
  if (!blob) throw Error('missing ' + name);
  const url = URL.createObjectURL(blob);
  imageURLs.set(name, url);
  return url;
}
function hydrateImages(root = document) {
  root.querySelectorAll('img[data-asset]:not([src])').forEach(img => {
    imageURL(img.dataset.asset).then(url => { img.src = url; }).catch(() => img.closest('figure')?.classList.add('image-error'));
  });
}
const imageHTML = (name, cls = 'question-img') => `<figure class="image-frame"><img class="${cls}" data-asset="${esc(name)}" alt="${esc(t('题目图片'))}"><figcaption>${esc(t('图片无法显示'))}</figcaption></figure>`;

// ---- helpers ----

function toast(text) {
  const e = document.createElement('div');
  e.className = 'toast'; e.setAttribute('role', 'status'); e.textContent = t(text);
  document.body.append(e);
  setTimeout(() => e.remove(), 4200);
}
function go(v) { view = v; render(); window.scrollTo({ top: 0, behavior: 'instant' }); }
const byId = id => bank.questions.find(q => q.id === id);
const practicable = () => bank.questions.filter(q => q.answer);
const sources = () => [...new Set(bank.questions.map(q => q.source).filter(Boolean))].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
function pool() {
  return practicable().filter(q => (filters.category === 'all' || q.category === filters.category) && (filters.type === 'all' || q.type === filters.type) && (filters.source === 'all' || q.source === filters.source));
}
const sessionSize = () => settings.sessionSize || bank.sessionSize || 8;
const typeBadge = q => `<span class="badge type-${q.type}">${esc(t(typeLabel(q.type)))}</span>`;
const sourceLine = q => [q.category, q.source].filter(Boolean).map(esc).join(' · ');

function questionBody(q) {
  return `${q.text ? `<div class="question-text" data-user-content>${esc(q.text)}</div>` : ''}${q.images.map(n => imageHTML(n)).join('')}`;
}

function optionsHTML(q, { picked = '', key = null, interactive = false } = {}) {
  const layout = q.options.some(o => o.image) ? ' image-grid' : q.options.some(o => o.text.length > 18) ? ' stacked' : '';
  return `<div class="options${layout}" role="group" aria-label="${esc(t('选项'))}">${q.options.map(o => {
    const chosen = picked.includes(o.key), right = key && key.includes(o.key);
    // In a multiple-choice review, a correct option the learner did not pick is "missed", not simply right.
    const missed = right && !chosen && q.type === 'multiple' && picked;
    const state = key ? (missed ? ' missed' : right ? ' right' : chosen ? ' wrong' : '') : chosen ? ' picked' : '';
    const mark = key ? (missed ? `<span class="mark">${esc(t('漏选'))}</span>` : right ? '<span class="mark">✓</span>' : chosen ? '<span class="mark">✗</span>' : '') : '';
    const body = `<span class="letter">${o.key}</span><span class="option-body">${o.text ? `<span data-user-content>${esc(o.text)}</span>` : ''}${o.image ? imageHTML(o.image, 'option-img') : ''}</span>${mark}`;
    return interactive
      ? `<button type="button" class="option${state}" data-option="${o.key}" aria-pressed="${chosen}">${body}</button>`
      : `<div class="option${state}">${body}</div>`;
  }).join('')}</div>`;
}

// ---- pages ----

const views = { home, quiz: quizView, result, wrong: wrongView, plan: planView, history: historyView, browse: browseView, banks: banksView, settings: settingsView };

function render() {
  document.documentElement.lang = interfaceLanguage === 'en' ? 'en' : 'zh-Hans';
  const due = dueToday(analysis.review).length;
  $('#nav').innerHTML = [
    ['home', '◫', '开始练习'], ['plan', '◷', '复习计划', due], ['wrong', '↺', '错题本', Object.values(analysis.wrong).filter(w => !w.mastered).length],
    ['history', '▤', '练习记录'], ['browse', '▦', '浏览题目'], ['banks', '⊞', '题库管理'], ['settings', '⚙', '设置'],
  ].map(([v, icon, label, n]) => `<button data-view="${v}" class="${view === v || (view === 'result' && v === 'history') || (view === 'quiz' && v === 'home') ? 'active' : ''}"><span aria-hidden="true">${icon}</span>${esc(t(label))}${n ? `<b>${n}</b>` : ''}</button>`).join('');
  $('#bank-name').textContent = bank.title;
  document.querySelectorAll('[data-language]').forEach(b => b.classList.toggle('selected', b.dataset.language === interfaceLanguage));
  views[view]();
  hydrateImages();
}

function home() {
  const p = pool(), size = sessionSize(), done = Object.keys(analysis.attempts).length, total = practicable().length;
  const graded = Object.values(analysis.attempts).flat(), due = dueToday(analysis.review).length;
  const counts = Object.fromEntries(TYPES.map(k => [k, practicable().filter(q => q.type === k).length]));
  const categories = bank.categories.map(c => [c, practicable().filter(q => q.category === c).length]).filter(([, n]) => n);
  $('#app').innerHTML = `
    <div class="hero"><div>
      <div class="eyebrow">${esc(t('今日练习'))}</div>
      <h1>${esc(bank.title)}</h1>
      <p>${esc(bank.description || t('每次一小轮，提交后集中批改，错题自动进入复习计划。'))}</p>
    </div><div class="hero-art" aria-hidden="true"><span>${size}</span></div></div>
    ${bank.demo ? `<div class="note demo-note">${esc(t('这是内置的示例题库。准备好自己的 Excel 题库后，到「题库管理」导入即可。'))} <button data-go="banks">${esc(t('导入我的题库 →'))}</button></div>` : ''}
    ${storageWarning ? `<p class="note">${esc(t('存储暂不可用或旧记录格式异常，请先到「设置」导出备份。'))}</p>` : ''}
    <div class="stats">
      <div class="stat"><strong>${done}<small> / ${total}</small></strong><span>${esc(t('已练题目 / 可练题数'))}</span></div>
      <div class="stat"><strong>${graded.length ? pct(graded.filter(a => a.correct).length / graded.length) : '—'}</strong><span>${esc(t('累计正确率'))}</span></div>
      <div class="stat"><strong>${due}</strong><span>${esc(t('今日待复习'))}</span></div>
      <div class="stat"><strong>${studyStreak(progress)}</strong><span>${esc(t('连续学习天数'))}</span></div>
    </div>
    <div class="layout">
      <section class="panel">
        <div class="section-heading"><h2>${esc(t('选择分类'))}</h2><span class="meta">${esc(t('{n} 个分类', { n: categories.length }))}</span></div>
        ${choiceButton('all', '✳', t('全部分类'), t('从所有分类中随机抽题'), practicable().length)}
        ${categories.map(([c, n], i) => choiceButton(c, String.fromCharCode(65 + (i % 26)), c, accuracyHint(c), n)).join('')}
      </section>
      <section><div class="panel session-panel">
        <div class="eyebrow">${esc(t('本轮设置'))}</div>
        <label for="type">${esc(t('题型'))}</label>
        <select id="type"><option value="all">${esc(t('全部题型'))}</option>${TYPES.filter(k => counts[k]).map(k => `<option value="${k}" ${filters.type === k ? 'selected' : ''}>${esc(t(typeLabel(k)))} · ${counts[k]}</option>`).join('')}</select>
        ${sources().length > 1 ? `<label for="source">${esc(t('来源'))}</label><select id="source"><option value="all">${esc(t('全部来源'))}</option>${sources().map(s => `<option ${filters.source === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>` : ''}
        <label for="size">${esc(t('每轮题数'))}</label>
        <select id="size">${[...new Set([5, 8, 10, 15, 20, 30, bank.sessionSize])].sort((a, b) => a - b).map(n => `<option value="${n}" ${n === size ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <label class="check"><input type="checkbox" id="prefer-new" ${settings.preferNew ? 'checked' : ''}> ${esc(t('优先抽没做过的题'))}</label>
        <div class="line"></div>
        <button class="primary wide" id="start" ${p.length ? '' : 'disabled'}>${esc(t('开始 {n} 题练习 →', { n: Math.min(size, p.length) }))}</button>
        ${due ? `<button class="wide secondary" id="review">${esc(t('先复习今天到期的 {n} 题', { n: due }))}</button>` : ''}
        ${progress.draft ? `<button class="wide secondary" id="resume">${esc(t('继续上次未完成的练习'))}</button>` : ''}
        <p class="meta">${esc(t('当前条件下有 {n} 题可选', { n: p.length }))}${bank.questions.length > total ? ' · ' + esc(t('{n} 题缺答案，只能浏览', { n: bank.questions.length - total })) : ''}</p>
      </div></section>
    </div>`;
  document.querySelectorAll('[data-choice]').forEach(b => b.onclick = () => { filters.category = b.dataset.choice; render(); });
  $('#type').onchange = e => { filters.type = e.target.value; render(); };
  if ($('#source')) $('#source').onchange = e => { filters.source = e.target.value; render(); };
  $('#size').onchange = e => { settings.sessionSize = +e.target.value; saveSettings(); render(); };
  $('#prefer-new').onchange = e => { settings.preferNew = e.target.checked; saveSettings(); };
  $('#start').onclick = () => start(pickQuestions(p, size, analysis, settings.preferNew));
  if ($('#review')) $('#review').onclick = () => start(dueToday(analysis.review).slice(0, Math.max(size, 20)).map(byId).filter(Boolean));
  if ($('#resume')) $('#resume').onclick = () => { pos = Math.min(progress.draft.pos || 0, progress.draft.ids.length - 1); go('quiz'); };
}

function accuracyHint(category) {
  const s = categoryStats(bank, analysis).find(x => x.category === category);
  return s?.accuracy === null || !s ? t('还没练过') : t('正确率 {p}', { p: pct(s.accuracy) });
}
function choiceButton(key, mark, title, hint, n) {
  return `<button class="topic ${filters.category === key ? 'selected' : ''}" data-choice="${esc(key)}" aria-pressed="${filters.category === key}"><em>${esc(mark)}</em><span><strong data-user-content>${esc(title)}</strong><small>${esc(hint)}</small></span><span class="count">${esc(t('{n} 题', { n }))}</span></button>`;
}

async function start(questions) {
  if (busy || !questions.length) return;
  busy = true;
  try {
    if (progress.draft && !(await uiConfirm('开始新一轮会替换未完成的练习，是否继续？'))) return;
    progress.draft = { ids: questions.map(q => q.id), answers: {}, pos: 0, started: Date.now() };
    saveProgress();
    pos = 0;
    await Promise.allSettled(questions.flatMap(q => [...q.images, ...q.options.map(o => o.image).filter(Boolean)]).map(imageURL));
    go('quiz');
  } finally { busy = false; }
}

function move(n) { pos = n; progress.draft.pos = pos; saveProgress(); render(); window.scrollTo({ top: 0, behavior: 'instant' }); }

function quizView() {
  const draft = progress.draft;
  if (!draft) return go('home');
  const q = byId(draft.ids[pos]), picked = draft.answers[q.id] || '', answered = Object.keys(draft.answers).length;
  $('#app').innerHTML = `
    <div class="quiz-head"><div><div class="eyebrow">${esc(t('专注这一题'))}</div><div class="quiz-meta">${typeBadge(q)}<span class="meta" data-user-content>${sourceLine(q)}</span></div></div><span class="pill">${pos + 1} / ${draft.ids.length}</span></div>
    <div class="progress">${draft.ids.map((id, i) => `<button data-pos="${i}" class="${draft.answers[id] ? 'chosen' : ''} ${pos === i ? 'current' : ''}" aria-label="${esc(t('第 {n} 题', { n: i + 1 }))}">${i + 1}</button>`).join('')}<span class="meta answered-count">${esc(t('已答 {a} / {n}', { a: answered, n: draft.ids.length }))}</span></div>
    <div class="question-box">
      ${questionBody(q)}
      ${q.type === 'multiple' ? `<p class="hint">${esc(t('多选题：选出所有正确答案，全部选对才得分。'))}</p>` : ''}
      ${optionsHTML(q, { picked, interactive: true })}
    </div>
    <div class="actions"><button id="prev" ${pos === 0 ? 'disabled' : ''}>${esc(t('← 上一题'))}</button><button id="leave">${esc(t('保存并退出'))}</button>${pos < draft.ids.length - 1 ? `<button class="primary" id="next">${esc(t('下一题 →'))}</button>` : `<button class="primary" id="submit">${esc(t('提交并批改 ✓'))}</button>`}</div>
    <p class="meta quiet">${esc(t('快捷键：数字 1–6 或字母选择选项，方向键切换题目，回车下一题'))}</p>`;
  document.querySelectorAll('[data-pos]').forEach(b => b.onclick = () => move(+b.dataset.pos));
  document.querySelectorAll('[data-option]').forEach(b => b.onclick = () => choose(q, b.dataset.option));
  $('#prev').onclick = () => move(pos - 1);
  $('#leave').onclick = () => go('home');
  if ($('#next')) $('#next').onclick = () => move(pos + 1);
  if ($('#submit')) $('#submit').onclick = submit;
}

function choose(q, key) {
  const draft = progress.draft, current = draft.answers[q.id] || '';
  const next = q.type === 'multiple' ? [...new Set(current.includes(key) ? current.replace(key, '') : current + key)].sort().join('') : key;
  if (next) draft.answers[q.id] = next; else delete draft.answers[q.id];
  saveProgress(); render();
}

function submit() {
  const draft = progress.draft, missing = draft.ids.filter(id => !draft.answers[id]);
  if (missing.length) { toast(t('还有 {n} 题未作答，已跳到第一道未答题。', { n: missing.length })); move(draft.ids.indexOf(missing[0])); return; }
  progress.history.unshift({ date: Date.now(), rows: draft.ids.map(id => ({ id, answer: draft.answers[id] })) });
  progress.draft = null; activeHistory = 0;
  saveProgress(); refresh(); go('result');
}

function reviewCard(id, answer, row, { kind = 'result' } = {}) {
  const q = byId(id);
  if (!q) return '';
  const graded = row ? analysis.rows.get(row) : { key: q.answer, correct: answer ? answer === q.answer : null };
  const correct = graded?.correct, w = analysis.wrong[id], ai = progress.ai.explanations[id], job = aiJobs.get(id);
  const status = correct === null ? `<span class="muted">${esc(t('无答案'))}</span>` : correct ? `<span class="good">${esc(t('✓ 正确'))}</span>` : `<span class="bad">${esc(t('× 需要订正'))}</span>`;
  return `<details class="panel result-card" ${correct === false || kind === 'wrong' ? 'open' : ''}>
    <summary>${status}　${typeBadge(q)} <span data-user-content>${sourceLine(q)}</span><span class="result-meta">${esc(t('你的答案'))} <b>${esc(letters(answer))}</b> · ${esc(t('正确答案'))} <b>${esc(letters(q.answer))}</b>${w ? ' · ' + esc(t('错过 {n} 次', { n: w.count })) : ''}</span></summary>
    ${questionBody(q)}
    ${optionsHTML(q, { picked: answer || '', key: q.answer })}
    ${q.explanation ? `<div class="explanation"><strong>${esc(t('解析'))}</strong><div data-user-content>${esc(q.explanation)}</div></div>` : ''}
    <div class="ai-box" data-ai-box="${esc(id)}">${aiBoxHTML(id, answer, ai, job)}</div>
    <label for="note-${esc(id)}">${esc(t('错因 / 学习笔记'))}</label>
    <textarea class="note-input" id="note-${esc(id)}" data-note="${esc(id)}" rows="2" placeholder="${esc(t('记下容易混淆的知识点，下次复习时再看。'))}">${esc(progress.notes[id] || '')}</textarea>
    ${kind === 'wrong' && w ? `<div class="card-actions"><span class="meta">${analysis.review[id] ? esc(t('下次复习：{d}', { d: fmtDate(analysis.review[id].due, { dateStyle: 'medium' }) })) : esc(t('已掌握'))}</span><button data-master="${esc(id)}">${esc(w.mastered ? t('改回待复习') : t('标记已掌握 ✓'))}</button></div>` : ''}
  </details>`;
}

function aiBoxHTML(id, answer, saved, job) {
  if (job) return `<div class="ai-head"><strong>${esc(t('AI 讲解'))}</strong><span class="meta">${esc(t('生成中…'))}</span><button data-ai-stop="${esc(id)}">${esc(t('停止'))}</button></div><div class="ai-text">${renderMarkdown(job.text || '…')}</div>`;
  if (saved) return `<div class="ai-head"><strong>${esc(t('AI 讲解'))}</strong><span class="meta">${esc(saved.model)} · ${esc(fmtDate(saved.at))}</span><button data-ai="${esc(id)}" data-answer="${esc(answer || '')}">${esc(t('重新生成'))}</button></div><div class="ai-text">${renderMarkdown(saved.text)}</div>`;
  return `<button class="ai-button" data-ai="${esc(id)}" data-answer="${esc(answer || '')}">✦ ${esc(t('AI 讲解这道题'))}</button>`;
}

function updateAiBox(id, answer) {
  document.querySelectorAll(`[data-ai-box="${CSS.escape(id)}"]`).forEach(box => { box.innerHTML = aiBoxHTML(id, answer, progress.ai.explanations[id], aiJobs.get(id)); });
  bindAi();
}

async function runExplain(id, answer) {
  const q = byId(id);
  if (aiJobs.has(id) || !q) return;
  const job = { text: '', controller: new AbortController() };
  aiJobs.set(id, job);
  updateAiBox(id, answer);
  try {
    const result = await explainMistake(q, answer, { signal: job.controller.signal, onText: text => {
      job.text = text;
      document.querySelectorAll(`[data-ai-box="${CSS.escape(id)}"] .ai-text`).forEach(el => { el.innerHTML = renderMarkdown(text); });
    } });
    progress.ai.explanations[id] = { text: result.text, model: result.model, at: Date.now() };
    saveProgress();
  } catch (err) {
    if (!err.cancelled) toast(err.message);
  } finally {
    aiJobs.delete(id);
    updateAiBox(id, answer);
  }
}

function bindAi() {
  document.querySelectorAll('[data-ai]').forEach(b => b.onclick = () => runExplain(b.dataset.ai, b.dataset.answer));
  document.querySelectorAll('[data-ai-stop]').forEach(b => b.onclick = () => aiJobs.get(b.dataset.aiStop)?.controller.abort());
}

function bindReview() {
  document.querySelectorAll('[data-note]').forEach(e => e.oninput = () => { progress.notes[e.dataset.note] = e.value; saveProgress(); });
  document.querySelectorAll('[data-master]').forEach(b => b.onclick = () => {
    const id = b.dataset.master;
    progress.mastery[id] = { value: !analysis.wrong[id].mastered, at: Date.now() };
    saveProgress(); refresh(); render();
  });
  bindAi();
}

function result() {
  const h = progress.history[activeHistory];
  if (!h) return go('history');
  const graded = h.rows.map(r => analysis.rows.get(r)).filter(g => g && g.correct !== null);
  const right = graded.filter(g => g.correct).length;
  $('#app').innerHTML = `
    <div class="hero"><div><div class="eyebrow">${esc(t('本轮完成'))}</div><h1>${esc(right === graded.length ? t('全部答对，太棒了！') : t('完成了，来订正一下。'))}</h1><p>${esc(fmtDate(h.date))} · ${esc(t('{n} 题', { n: h.rows.length }))}</p></div>
    <div class="result-score"><strong>${right}<small> / ${graded.length}</small></strong><span>${esc(t('答对'))}</span></div></div>
    <div class="result-strip"><span class="good">${esc(t('✓ {n} 题正确', { n: right }))}</span><span class="bad">${esc(t('× {n} 题错误', { n: graded.length - right }))}</span>${h.rows.length > graded.length ? `<span>${esc(t('{n} 题无答案', { n: h.rows.length - graded.length }))}</span>` : ''}</div>
    ${h.rows.map(r => reviewCard(r.id, r.answer, r)).join('')}
    <div class="actions"><button data-go="wrong">${esc(t('查看错题本'))}</button><button class="primary" data-go="home">${esc(t('再练一轮 →'))}</button></div>`;
  bindReview();
}

function wrongView() {
  const all = Object.keys(analysis.wrong).filter(byId), active = all.filter(id => !analysis.wrong[id].mastered);
  const shown = all.filter(id => wrongFilter === 'all' || (wrongFilter === 'mastered' ? analysis.wrong[id].mastered : !analysis.wrong[id].mastered))
    .filter(id => filters.category === 'all' || byId(id).category === filters.category)
    .sort((a, b) => analysis.wrong[b].lastWrong - analysis.wrong[a].lastWrong);
  const cats = [...new Set(all.map(id => byId(id).category))];
  $('#app').innerHTML = `
    <div class="hero"><div><div class="eyebrow">${esc(t('从错误中学习'))}</div><h1>${esc(t('把错题，练成会做的题。'))}</h1><p>${esc(t('{a} 道待复习 · {m} 道已掌握', { a: active.length, m: all.length - active.length }))}</p></div></div>
    <div class="toolbar"><div class="tabs">${[['active', '待复习'], ['mastered', '已掌握'], ['all', '全部']].map(([k, label]) => `<button data-wrong-filter="${k}" class="${wrongFilter === k ? 'selected' : ''}">${esc(t(label))}</button>`).join('')}</div>
    ${cats.length > 1 ? `<select id="wrong-cat" aria-label="${esc(t('分类'))}"><option value="all">${esc(t('全部分类'))}</option>${cats.map(c => `<option ${filters.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>` : ''}
    <button class="primary" id="retry" ${active.length ? '' : 'disabled'}>${esc(t('重练 {n} 道错题 →', { n: Math.min(active.length, sessionSize()) }))}</button></div>
    ${shown.length ? shown.map(id => reviewCard(id, analysis.wrong[id].answer, null, { kind: 'wrong' })).join('') : `<div class="panel empty"><h2>${esc(t('这里暂时没有题目'))}</h2><p>${esc(t('提交练习后，答错的题会自动归档；按复习计划答对几次后会标记为已掌握。'))}</p><button data-go="home">${esc(t('开始一轮练习'))}</button></div>`}`;
  document.querySelectorAll('[data-wrong-filter]').forEach(b => b.onclick = () => { wrongFilter = b.dataset.wrongFilter; render(); });
  if ($('#wrong-cat')) $('#wrong-cat').onchange = e => { filters.category = e.target.value; render(); };
  $('#retry').onclick = () => start(pickQuestions(active.map(byId), sessionSize(), analysis, false));
  bindReview();
}

function planView() {
  const stats = categoryStats(bank, analysis), forecast = reviewForecast(analysis.review), due = dueToday(analysis.review);
  const max = Math.max(1, ...forecast.map(f => f.count)), plan = progress.ai.plan, inputs = plan?.inputs || {};
  const graded = Object.values(analysis.attempts).flat();
  $('#app').innerHTML = `
    <div class="hero"><div><div class="eyebrow">${esc(t('复习计划'))}</div><h1>${esc(t('按遗忘规律，安排每天的复习。'))}</h1><p>${esc(t('答错的题会在 1、3、7、14 天后再出现；连续答对 4 次即视为掌握。'))}</p></div></div>
    <div class="stats">
      <div class="stat"><strong>${due.length}</strong><span>${esc(t('今日待复习'))}</span></div>
      <div class="stat"><strong>${Object.keys(analysis.review).length}</strong><span>${esc(t('复习中的题目'))}</span></div>
      <div class="stat"><strong>${graded.length ? pct(graded.filter(a => a.correct).length / graded.length) : '—'}</strong><span>${esc(t('累计正确率'))}</span></div>
      <div class="stat"><strong>${studyStreak(progress)}</strong><span>${esc(t('连续学习天数'))}</span></div>
    </div>
    <div class="plan-grid">
      <section class="panel"><div class="section-heading"><h2>${esc(t('未来 7 天'))}</h2>${due.length ? `<button class="primary" id="review-now">${esc(t('现在复习 {n} 题 →', { n: due.length }))}</button>` : ''}</div>
        <div class="forecast">${forecast.map((f, i) => `<div class="bar"><span class="bar-count">${f.count || ''}</span><span class="bar-fill" style="height:${Math.round((f.count / max) * 100)}%"></span><span class="bar-day">${esc(i === 0 ? t('今天') : fmtDate(f.day, { weekday: 'short' }))}</span></div>`).join('')}</div>
      </section>
      <section class="panel"><h2>${esc(t('分类掌握情况'))}</h2>
        <div class="table-wrap"><table class="cat-table"><thead><tr><th>${esc(t('分类'))}</th><th>${esc(t('正确率'))}</th><th>${esc(t('已练'))}</th><th>${esc(t('待复习'))}</th><th></th></tr></thead><tbody>
        ${stats.map(s => `<tr><td data-user-content>${esc(s.category)}</td><td><span class="acc${s.accuracy === null ? ' none' : ''}" style="--p:${s.accuracy ?? 0}">${pct(s.accuracy)}</span></td><td>${s.practiced} / ${s.total}</td><td>${s.activeWrong || ''}</td><td><button data-practice="${esc(s.category)}">${esc(t('练习'))}</button></td></tr>`).join('')}
        </tbody></table></div>
      </section>
    </div>
    <section class="panel ai-plan">
      <div class="section-heading"><h2>✦ ${esc(t('AI 复习计划'))}</h2><span class="meta">${esc(t('根据你的练习数据，生成一份按天安排的计划'))}</span></div>
      <div class="plan-form">
        <label>${esc(t('考试日期（可不填）'))}<input type="date" id="exam-date" value="${esc(inputs.examDate || '')}"></label>
        <label>${esc(t('每天可用时间'))}<select id="daily-minutes">${[15, 30, 45, 60, 90, 120].map(m => `<option value="${m}" ${(inputs.minutes || 30) === m ? 'selected' : ''}>${esc(t('{n} 分钟', { n: m }))}</option>`).join('')}</select></label>
        <label class="grow">${esc(t('补充说明（可不填）'))}<input id="plan-note" value="${esc(inputs.note || '')}" placeholder="${esc(t('例如：周末时间多一些；想先补薄弱分类'))}"></label>
        ${planJob ? `<button id="plan-stop">${esc(t('停止'))}</button>` : `<button class="primary" id="plan-go" ${graded.length ? '' : 'disabled'}>${esc(plan ? t('重新生成') : t('生成计划'))}</button>`}
      </div>
      ${graded.length ? '' : `<p class="meta">${esc(t('先完成至少一轮练习，AI 才有数据可以分析。'))}</p>`}
      <div class="ai-text plan-text">${planJob ? renderMarkdown(planJob.text || '…') : plan ? renderMarkdown(plan.text) + `<p class="meta">${esc(plan.model)} · ${esc(fmtDate(plan.at))}</p>` : ''}</div>
    </section>`;
  if ($('#review-now')) $('#review-now').onclick = () => start(due.slice(0, Math.max(sessionSize(), 20)).map(byId).filter(Boolean));
  document.querySelectorAll('[data-practice]').forEach(b => b.onclick = () => { filters.category = b.dataset.practice; go('home'); });
  if ($('#plan-go')) $('#plan-go').onclick = runPlan;
  if ($('#plan-stop')) $('#plan-stop').onclick = () => planJob?.controller.abort();
}

function planSummary(inputs) {
  const stats = categoryStats(bank, analysis), graded = Object.values(analysis.attempts).flat();
  const recentWrong = Object.entries(analysis.wrong).filter(([, w]) => !w.mastered).sort((a, b) => b[1].lastWrong - a[1].lastWrong).slice(0, 30)
    .map(([id, w]) => { const q = byId(id); return q && `- [${q.category}] ${t(typeLabel(q.type))} · ${(q.text || t('（图片题）')).replace(/\s+/g, ' ').slice(0, 80)} · ${t('错 {n} 次', { n: w.count })}`; }).filter(Boolean);
  return [
    `${t('题库')}：${bank.title}（${t('{n} 题', { n: practicable().length })}）`,
    `${t('今天')}：${new Date().toISOString().slice(0, 10)}`,
    inputs.examDate ? `${t('考试日期')}：${inputs.examDate}` : t('没有考试日期，请安排接下来 7 天。'),
    `${t('每天可用时间')}：${t('{n} 分钟', { n: inputs.minutes })}（${t('每题约 1–2 分钟，复习错题约 2–3 分钟')}）`,
    inputs.note ? `${t('补充说明')}：${inputs.note}` : '',
    `${t('已练题目')}：${Object.keys(analysis.attempts).length} / ${practicable().length}；${t('累计正确率')}：${graded.length ? pct(graded.filter(a => a.correct).length / graded.length) : '—'}；${t('连续学习天数')}：${studyStreak(progress)}`,
    `${t('未来 7 天到期复习题数')}：${reviewForecast(analysis.review).map(f => f.count).join(', ')}`,
    `${t('分类统计（分类 | 正确率 | 已练/总数 | 待复习错题）')}：`,
    ...stats.map(s => `- ${s.category} | ${pct(s.accuracy)} | ${s.practiced}/${s.total} | ${s.activeWrong}`),
    recentWrong.length ? `${t('最近的错题')}：\n${recentWrong.join('\n')}` : '',
  ].filter(Boolean).join('\n');
}

async function runPlan() {
  const inputs = { examDate: $('#exam-date').value, minutes: +$('#daily-minutes').value, note: $('#plan-note').value.trim() };
  planJob = { text: '', controller: new AbortController() };
  render();
  try {
    const result = await draftReviewPlan(planSummary(inputs), { signal: planJob.controller.signal, onText: text => {
      planJob.text = text;
      const el = $('.plan-text');
      if (el) el.innerHTML = renderMarkdown(text);
    } });
    progress.ai.plan = { text: result.text, model: result.model, at: Date.now(), inputs };
    saveProgress();
  } catch (err) {
    if (!err.cancelled) toast(err.message);
  } finally {
    planJob = null;
    if (view === 'plan') render();
  }
}

function historyView() {
  $('#app').innerHTML = `
    <div class="hero"><div><div class="eyebrow">${esc(t('练习记录'))}</div><h1>${esc(t('练习留下的足迹。'))}</h1><p>${esc(t('可以随时回来订正、补充笔记。'))}</p></div></div>
    <div class="panel">${progress.history.length ? progress.history.map((h, i) => {
      const graded = h.rows.map(r => analysis.rows.get(r)).filter(g => g && g.correct !== null);
      return `<div class="history-row"><div><strong>${esc(fmtDate(h.date))}</strong><p>${esc(t('{n} 题', { n: h.rows.length }))} · ${esc(t('正确 {a} / {b}', { a: graded.filter(g => g.correct).length, b: graded.length }))}</p></div><button data-history="${i}">${esc(t('查看与订正 →'))}</button></div>`;
    }).join('') : `<div class="empty"><h2>${esc(t('还没有练习记录'))}</h2><button data-go="home">${esc(t('开始第一轮练习'))}</button></div>`}</div>`;
  document.querySelectorAll('[data-history]').forEach(b => b.onclick = () => { activeHistory = +b.dataset.history; go('result'); });
}

function browseView() {
  const query = browse.query.toLowerCase().trim();
  const rows = bank.questions.filter(q => (filters.category === 'all' || q.category === filters.category) && (filters.type === 'all' || q.type === filters.type)
    && (!query || [q.id, q.text, q.source, q.category, ...q.tags, ...q.options.map(o => o.text)].join(' ').toLowerCase().includes(query)));
  const pages = Math.max(1, Math.ceil(rows.length / 12));
  browse.page = Math.min(browse.page, pages - 1);
  $('#app').innerHTML = `
    <div class="hero"><div><div class="eyebrow">${esc(t('浏览题目'))}</div><h1>${esc(t('题库，按你的节奏翻。'))}</h1><p>${esc(t('搜索题目文字、选项、来源或标签。'))}</p></div></div>
    <div class="panel library-filters">
      <label>${esc(t('搜索'))}<input id="search" value="${esc(browse.query)}" placeholder="${esc(t('输入关键词'))}"></label>
      <label>${esc(t('分类'))}<select id="browse-cat"><option value="all">${esc(t('全部分类'))}</option>${bank.categories.map(c => `<option ${filters.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <label>${esc(t('题型'))}<select id="browse-type"><option value="all">${esc(t('全部题型'))}</option>${TYPES.map(k => `<option value="${k}" ${filters.type === k ? 'selected' : ''}>${esc(t(typeLabel(k)))}</option>`).join('')}</select></label>
      <button id="search-btn">${esc(t('查找'))}</button>
    </div>
    <p class="meta">${esc(t('找到 {n} 题 · 第 {p} / {pages} 页', { n: rows.length, p: browse.page + 1, pages }))}</p>
    ${rows.slice(browse.page * 12, (browse.page + 1) * 12).map(q => `<details class="panel result-card"><summary>${typeBadge(q)} <span data-user-content>${esc((q.text || t('（图片题）')).slice(0, 60))}</span><span class="result-meta" data-user-content>${sourceLine(q)}</span></summary>
      ${questionBody(q)}${optionsHTML(q)}
      <details class="answer-reveal"><summary>${esc(t('查看答案'))}</summary><p>${q.answer ? esc(t('正确答案：{a}', { a: letters(q.answer) })) : esc(t('题库里没有这题的答案'))}</p>${q.explanation ? `<p data-user-content>${esc(q.explanation)}</p>` : ''}</details>
    </details>`).join('') || `<div class="empty">${esc(t('没有找到匹配的题目。'))}</div>`}
    <div class="actions"><button id="lib-prev" ${browse.page === 0 ? 'disabled' : ''}>${esc(t('← 上一页'))}</button><button id="lib-next" ${browse.page >= pages - 1 ? 'disabled' : ''}>${esc(t('下一页 →'))}</button></div>`;
  const search = () => { browse.query = $('#search').value; browse.page = 0; render(); };
  $('#search-btn').onclick = search;
  $('#search').onkeydown = e => { if (e.key === 'Enter') search(); };
  $('#browse-cat').onchange = e => { filters.category = e.target.value; browse.page = 0; render(); };
  $('#browse-type').onchange = e => { filters.type = e.target.value; browse.page = 0; render(); };
  $('#lib-prev').onclick = () => { browse.page--; render(); window.scrollTo(0, 0); };
  $('#lib-next').onclick = () => { browse.page++; render(); window.scrollTo(0, 0); };
}

function banksView() {
  const preview = pendingImport;
  $('#app').innerHTML = `
    <div class="hero"><div><div class="eyebrow">${esc(t('题库管理'))}</div><h1>${esc(t('任何选择题，都能变成你的题库。'))}</h1><p>${esc(t('用 Excel 准备题目和答案，图片放在同一个文件夹里，打包成 zip 或一起选中导入。'))}</p></div></div>
    ${preview ? importPreviewHTML(preview) : `
    <section class="panel drop-zone" id="drop-zone">
      <h2>${esc(t('导入题库'))}</h2>
      <p>${esc(t('支持：.xlsx / .csv 表格，配图（png、jpg、gif、webp、svg），或把它们打包成一个 .zip。也可以直接把文件拖到这里。'))}</p>
      <label class="file-button primary">${esc(t('选择文件…'))}<input type="file" id="import-files" multiple accept=".xlsx,.csv,.tsv,.zip,image/*"></label>
      <div class="downloads"><button id="dl-template">⤓ ${esc(t('下载空白模板（.xlsx）'))}</button><button id="dl-demo">⤓ ${esc(t('下载示例题库（.zip）'))}</button></div>
      <details class="format-help"><summary>${esc(t('表格格式说明'))}</summary>${formatHelpHTML()}</details>
    </section>`}
    <section class="panel"><h2>${esc(t('我的题库'))}</h2>
      ${banks.map(b => `<div class="bank-row ${b.id === bank.id ? 'current' : ''}"><div><strong data-user-content>${esc(b.title)}</strong>${b.id === bank.id ? ` <span class="pill">${esc(t('当前'))}</span>` : ''}<p>${esc(t('{n} 题', { n: b.questions.length }))} · ${esc(t('{n} 个分类', { n: b.categories.length }))} · ${esc(t('导入于 {d}', { d: fmtDate(b.importedAt, { dateStyle: 'medium' }) }))} · <span data-user-content>${esc(b.sourceFile)}</span></p></div>
        <div class="bank-actions">${b.id === bank.id ? '' : `<button class="primary" data-open-bank="${esc(b.id)}">${esc(t('切换到这个题库'))}</button>`}<button class="danger-link" data-delete-bank="${esc(b.id)}">${esc(t('删除'))}</button></div></div>`).join('')}
    </section>`;
  if (preview) {
    $('#import-confirm').onclick = confirmImport;
    $('#import-cancel').onclick = () => { pendingImport = null; render(); };
  } else {
    $('#import-files').onchange = e => readImport([...e.target.files]);
    const zone = $('#drop-zone');
    zone.ondragover = e => { e.preventDefault(); zone.classList.add('dragging'); };
    zone.ondragleave = () => zone.classList.remove('dragging');
    zone.ondrop = e => { e.preventDefault(); zone.classList.remove('dragging'); readImport([...e.dataTransfer.files]); };
    $('#dl-template').onclick = () => saveFile(t('题库模板') + '.xlsx', base64ToBytes(window.DAILY8_FILES.templateXlsx), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    $('#dl-demo').onclick = () => saveFile(t('示例题库') + '.zip', base64ToBytes(window.DAILY8_FILES.demoZip), 'application/zip');
  }
  document.querySelectorAll('[data-open-bank]').forEach(b => b.onclick = async () => { await openBank(b.dataset.openBank); toast(t('已切换到「{name}」', { name: bank.title })); go('home'); });
  document.querySelectorAll('[data-delete-bank]').forEach(b => b.onclick = () => deleteBank(b.dataset.deleteBank));
}

function formatHelpHTML() {
  const rows = [
    ['题目', '题目文字。整题是截图时可以留空，在「图片」列填文件名。'],
    ['A – F', '选项文字（最多 6 个）。也可以填图片文件名，或把图片直接粘贴到这个单元格里。'],
    ['答案', '单选填一个字母，如 B；多选填多个，如 ACD；判断题填 对 / 错（或 A / B）。'],
    ['题型', '单选、多选、判断。可不填：多个字母自动当多选，对 / 错自动当判断。'],
    ['分类', '知识点或章节，用来分类练习和统计掌握情况。'],
    ['图片', '题目配图的文件名，多个用分号隔开；也可以把图片直接粘贴到这一行。'],
    ['来源 · 难度 · 解析 · 标签 · 编号 · 选项数', '都可以不填。「编号」用来在更新题库时保留学习记录；整题截图且没有选项文字时，用「选项数」指定有几个选项（默认 4）。'],
  ];
  return `<table class="format-table"><tbody>${rows.map(([k, v]) => `<tr><th>${esc(t(k))}</th><td>${esc(t(v))}</td></tr>`).join('')}</tbody></table>
    <p class="meta">${esc(t('可选的「设置」工作表：第一列写 名称 / 简介 / 每轮题数 / 编号，第二列写对应的值。'))}</p>`;
}

async function readImport(files) {
  if (!files.length) return;
  try {
    const entries = await Promise.all(files.map(async f => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
    const parsed = buildBank(entries);
    pendingImport = { ...parsed, replaces: banks.find(b => b.id === parsed.bank.id) || null };
  } catch (err) {
    pendingImport = null;
    toast(err.message || t('无法读取这些文件。'));
    if (err.errors?.length) pendingImport = { failed: true, errors: err.errors, message: err.message };
  }
  render();
}

function importPreviewHTML(p) {
  const issues = (list, cls) => list.length ? `<ul class="issues ${cls}">${list.slice(0, 50).map(e => `<li>${e.row ? esc(t('第 {n} 行：', { n: e.row })) : ''}<span data-user-content>${esc(e.message)}</span></li>`).join('')}${list.length > 50 ? `<li>${esc(t('还有 {n} 条…', { n: list.length - 50 }))}</li>` : ''}</ul>` : '';
  if (p.failed) return `<section class="panel import-preview"><h2>${esc(p.message)}</h2>${issues(p.errors, 'errors')}<div class="actions"><button id="import-cancel">${esc(t('返回'))}</button><span></span><button id="import-confirm" disabled>${esc(t('确认导入'))}</button></div></section>`;
  const b = p.bank, byType = TYPES.map(k => [k, b.questions.filter(q => q.type === k).length]).filter(([, n]) => n);
  return `<section class="panel import-preview">
    <div class="eyebrow">${esc(t('导入预览'))}</div><h2 data-user-content>${esc(b.title)}</h2>
    ${p.replaces ? `<p class="note">${esc(t('将更新已有的题库「{name}」。题目编号不变的题，学习记录会保留。', { name: p.replaces.title }))}</p>` : ''}
    <div class="stats compact">
      <div class="stat"><strong>${b.questions.length}</strong><span>${esc(t('题目'))}</span></div>
      <div class="stat"><strong>${b.categories.length}</strong><span>${esc(t('分类'))}</span></div>
      <div class="stat"><strong>${p.assets.size}</strong><span>${esc(t('图片'))}</span></div>
      <div class="stat"><strong>${b.questions.filter(q => !q.answer).length}</strong><span>${esc(t('缺答案'))}</span></div>
    </div>
    <p>${byType.map(([k, n]) => `${esc(t(typeLabel(k)))} ${n}`).join(' · ')}　|　${b.categories.slice(0, 12).map(esc).join('、')}${b.categories.length > 12 ? '…' : ''}</p>
    ${p.errors.length ? `<h3 class="bad">${esc(t('{n} 行有错误，不会导入', { n: p.errors.length }))}</h3>${issues(p.errors, 'errors')}` : ''}
    ${p.warnings.length ? `<h3>${esc(t('{n} 条提醒', { n: p.warnings.length }))}</h3>${issues(p.warnings, 'warnings')}` : ''}
    <div class="actions"><button id="import-cancel">${esc(t('取消'))}</button><span></span><button class="primary" id="import-confirm">${esc(t('确认导入 {n} 题', { n: b.questions.length }))}</button></div>
  </section>`;
}

async function confirmImport() {
  const p = pendingImport;
  try {
    await bankStore.save(p.bank, p.assets);
    pendingImport = null;
    banks = banks.filter(b => b.id !== p.bank.id).concat(p.bank);
    await openBank(p.bank.id);
    toast(t('已导入「{name}」，共 {n} 题', { name: p.bank.title, n: p.bank.questions.length }));
    go('home');
  } catch (err) { toast(t('保存题库失败：{msg}', { msg: err.message || err })); }
}

async function deleteBank(id) {
  const target = banks.find(b => b.id === id);
  if (!(await uiConfirm(t('删除题库「{name}」？这个题库的学习记录也会一起删除，无法恢复。', { name: target.title }), { ok: '删除', danger: true }))) return;
  await bankStore.remove(id);
  appStore.remove(progressKey(id));
  await loadBanks();
  await openBank(id === bank.id ? banks[0].id : bank.id);
  toast(t('已删除「{name}」', { name: target.title }));
  render();
}

function settingsView() {
  const key = appSecrets.get(API_KEY_SECRET);
  $('#app').innerHTML = `
    <div class="hero"><div><div class="eyebrow">${esc(t('设置'))}</div><h1>${esc(t('让它更适合你。'))}</h1></div></div>
    <div class="settings-grid">
      <section class="panel"><h2>✦ ${esc(t('AI 讲解'))}</h2>
        <p>${esc(t('AI 讲解错题和复习计划使用你自己的 OpenAI API Key（也可以用任何兼容 OpenAI 接口的服务），费用由服务商按用量计费。没有 Key 也可以正常刷题。'))}</p>
        <label for="api-key">API Key</label>
        <div class="inline-form"><input id="api-key" type="password" autocomplete="off" spellcheck="false" placeholder="${esc(key ? t('已保存（输入新值可替换）') : 'sk-…')}"><button class="primary" id="save-key">${esc(t('保存'))}</button>${key ? `<button id="clear-key">${esc(t('清除'))}</button>` : ''}</div>
        <p class="meta">${esc(appStore.native ? t('Key 保存在本机的 macOS 钥匙串里，只会发送给下面的接口地址。') : t('Key 保存在这个浏览器里，只会发送给下面的接口地址。在公用电脑上用完请清除。'))} <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">${esc(t('获取 OpenAI API Key'))}</a></p>
        <label for="ai-base">${esc(t('接口地址'))}</label>
        <input id="ai-base" class="wide-input" spellcheck="false" value="${esc(settings.ai.baseURL)}" placeholder="${esc(DEFAULT_BASE_URL)}">
        <p class="meta">${esc(t('留空即使用 OpenAI 官方接口。使用 DeepSeek、通义千问或中转服务时，填写对方提供的地址（通常以 /v1 结尾）。'))}</p>
        <label for="ai-model">${esc(t('模型'))}</label>
        <input id="ai-model" class="wide-input" list="ai-models" spellcheck="false" value="${esc(settings.ai.model)}" placeholder="${esc(DEFAULT_AI_MODEL)}">
        <datalist id="ai-models">${aiModelList.map(m => `<option value="${esc(m)}">`).join('')}</datalist>
        <p class="meta">${esc(t('填写模型名称；点「测试连接」后，这里可以从接口提供的模型里选择。'))}</p>
        <label class="check"><input type="checkbox" id="ai-images" ${aiSendsImages() ? 'checked' : ''}> ${esc(t('发送题目图片（所选模型需要支持识图）'))}</label>
        <div class="line"></div>
        <button id="test-ai" ${key ? '' : 'disabled'}>${esc(t('测试连接'))}</button> <span id="ai-status" class="meta" role="status"></span>
      </section>
      <section class="panel"><h2>${esc(t('备份与恢复'))}</h2>
        <p>${esc(t('学习记录保存在本机。换设备前先导出备份；题库文件请自己保留一份，换设备后重新导入即可。'))}</p>
        <button class="primary wide" id="export">${esc(t('导出全部学习记录'))}</button>
        <div class="line"></div>
        <label for="restore">${esc(t('从备份文件恢复'))}</label>
        <input id="restore" type="file" accept=".json,application/json">
        <p class="meta">${esc(t('只会恢复已导入题库的记录，恢复前会请你确认。'))}</p>
        <div class="line"></div>
        <h2>${esc(t('关于'))}</h2>
        <p class="meta">Daily 8 · ${esc(window.DAILY8_FILES.version)} · ${esc(appStore.native ? 'macOS' : t('网页版'))}</p>
      </section>
    </div>`;
  $('#save-key').onclick = () => {
    const value = $('#api-key').value.trim();
    if (!value) return toast('请先输入 API Key');
    appSecrets.set(API_KEY_SECRET, value); toast('API Key 已保存'); render();
  };
  if ($('#clear-key')) $('#clear-key').onclick = () => { appSecrets.set(API_KEY_SECRET, ''); toast('API Key 已清除'); render(); };
  $('#ai-base').onchange = e => { settings.ai.baseURL = e.target.value.trim(); saveSettings(); };
  $('#ai-model').onchange = e => { settings.ai.model = e.target.value.trim(); saveSettings(); };
  $('#ai-images').onchange = e => { settings.ai.images = e.target.checked; saveSettings(); };
  $('#test-ai').onclick = async () => {
    const status = $('#ai-status');
    status.textContent = t('连接中…'); status.className = 'meta';
    try {
      const { ids, found } = await testAiConnection();
      aiModelList = ids;
      $('#ai-models').innerHTML = ids.map(m => `<option value="${esc(m)}">`).join('');
      status.textContent = found || !ids.length ? t('连接成功，可以使用 {m}', { m: aiModel() }) : t('连接成功，但接口的模型列表里没有 {m}，请检查模型名称。', { m: aiModel() });
      status.className = found || !ids.length ? 'good' : 'bad';
    } catch (err) { status.textContent = err.message; status.className = 'bad'; }
  };
  $('#export').onclick = exportBackup;
  $('#restore').onchange = async e => {
    try { const file = e.target.files[0]; if (file) await restoreBackup(JSON.parse(await file.text())); }
    catch (err) { toast(err.message || t('无法读取备份，当前记录未改变。')); }
    finally { e.target.value = ''; }
  };
}

function exportBackup() {
  const data = { app: 'daily8', exportVersion: 1, exportedAt: Date.now(), settings: { ...settings }, banks: {} };
  for (const b of banks) {
    const raw = b.id === bank.id ? JSON.stringify(progress) : appStore.get(progressKey(b.id));
    if (raw) data.banks[b.id] = { title: b.title, progress: JSON.parse(raw) };
  }
  saveFile(`daily8-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json');
}

async function restoreBackup(data) {
  if (data?.app !== 'daily8' || !data.banks) throw Error(t('这不是 Daily 8 的备份文件。'));
  const entries = Object.entries(data.banks), imported = id => banks.some(b => b.id === id);
  const known = entries.filter(([id]) => imported(id)), unknown = entries.filter(([id]) => !imported(id)).map(([, b]) => b);
  if (!known.length) throw Error(t('备份里的题库都还没有导入。请先导入对应题库：{names}', { names: unknown.map(b => b.title).join('、') }));
  const restored = known.map(([id, b]) => [id, normalizeProgress(b.progress, banks.find(x => x.id === id))]);
  const message = t('将恢复 {n} 个题库的学习记录，并替换这些题库当前的记录。是否继续？', { n: restored.length }) + (unknown.length ? '\n' + t('（{n} 个题库尚未导入，已跳过）', { n: unknown.length }) : '');
  if (!(await uiConfirm(message))) return;
  for (const [id, p] of restored) appStore.set(progressKey(id), JSON.stringify(p));
  await openBank(bank.id);
  toast('备份已恢复');
  render();
}

// ---- global events ----

document.addEventListener('click', e => {
  const nav = e.target.closest('[data-go],[data-view]');
  if (nav) { go(nav.dataset.go || nav.dataset.view); return; }
  const lang = e.target.closest('[data-language]');
  if (lang && lang.dataset.language !== interfaceLanguage) { interfaceLanguage = settings.lang = lang.dataset.language; saveSettings(); render(); return; }
  const img = e.target.closest('.question-img, .option-img');
  if (!img || !img.src || e.target.closest('button.option')) return;
  const zoom = document.createElement('div');
  zoom.className = 'zoom'; zoom.setAttribute('role', 'dialog'); zoom.setAttribute('aria-modal', 'true');
  const close = document.createElement('button');
  close.textContent = t('关闭 ×');
  close.onclick = () => { zoom.remove(); document.body.style.overflow = ''; };
  const copy = document.createElement('img');
  copy.src = img.src;
  zoom.append(close, copy);
  document.body.append(zoom);
  document.body.style.overflow = 'hidden';
  close.focus();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { document.querySelector('.zoom button')?.click(); return; }
  if (view !== 'quiz' || !progress.draft || document.querySelector('.zoom,.dialog-backdrop') || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.metaKey || e.ctrlKey) return;
  const q = byId(progress.draft.ids[pos]), k = e.key.toUpperCase();
  const index = /^[1-6]$/.test(k) ? +k - 1 : 'ABCDEF'.indexOf(k);
  if (k.length === 1 && index >= 0 && index < q.options.length) choose(q, q.options[index].key);
  else if (e.key === 'ArrowRight' && pos < progress.draft.ids.length - 1) move(pos + 1);
  else if (e.key === 'ArrowLeft' && pos > 0) move(pos - 1);
  else if (e.key === 'Enter' && !e.target.closest('button')) (pos < progress.draft.ids.length - 1 ? move(pos + 1) : submit());
});

// A file dropped outside the import area must not navigate away from the app.
for (const type of ['dragover', 'drop']) document.addEventListener(type, e => { if (!e.target.closest?.('#drop-zone')) e.preventDefault(); });

async function init() {
  loadSettings();
  interfaceLanguage = settings.lang || interfaceLanguage;
  try {
    await loadBanks();
    await openBank(settings.bankId);
    render();
  } catch (err) {
    $('#app').innerHTML = `<div class="empty"><h1>${esc(t('无法打开题库存储'))}</h1><p>${esc(err.message || err)}</p><button onclick="location.reload()">${esc(t('重新加载'))}</button></div>`;
  }
}
init();
