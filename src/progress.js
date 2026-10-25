'use strict';
// Per-bank study progress. Everything derived (grading, wrong book, review schedule, stats) is recomputed from the
// answer history, so restoring a backup or re-importing a bank with corrected keys regrades consistently.

const DAY = 864e5;
const REVIEW_INTERVALS = [1, 3, 7, 14]; // days until the next review after a mistake, then after each correct review
const startOfDay = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

const emptyProgress = () => ({ history: [], notes: {}, mastery: {}, draft: null, ai: { explanations: {}, plan: null } });

function normalizeProgress(raw, bank) {
  if (!raw || typeof raw !== 'object') throw Error(t('记录格式不正确'));
  const p = { ...emptyProgress(), ...raw, ai: { explanations: {}, plan: null, ...(raw.ai || {}) } };
  for (const k of ['notes', 'mastery']) if (!p[k] || typeof p[k] !== 'object' || Array.isArray(p[k])) throw Error(t('记录格式不正确'));
  if (!Array.isArray(p.history) || p.history.some(h => !Number.isFinite(h.date) || !Array.isArray(h.rows))) throw Error(t('练习记录格式不正确'));
  if (bank) {
    // Questions removed from the bank keep their history, but drafts must only reference current questions.
    const ids = new Set(bank.questions.map(q => q.id));
    if (p.draft && (!Array.isArray(p.draft.ids) || p.draft.ids.some(id => !ids.has(id)))) p.draft = null;
  }
  return p;
}

const isCorrect = (answer, key) => !!key && answer === key;

/**
 * Returns { rows, wrong, review, attempts } where
 *   rows: Map(history row -> {key, correct}) for display,
 *   wrong: {id: {answer, key, count, lastWrong, mastered}} — every question ever answered wrong,
 *   review: {id: {stage, due}} — questions still in the review cycle,
 *   attempts: {id: [{date, correct}]}.
 */
function analyze(bank, progress) {
  const byId = new Map(bank.questions.map(q => [q.id, q]));
  const events = [];
  for (const h of progress.history) for (const r of h.rows) {
    const q = byId.get(r.id);
    if (q) events.push({ id: r.id, date: h.date, answer: r.answer, key: q.answer, row: r });
  }
  // Manual "mastered" / "review again" marks sit on the same timeline as answers.
  for (const [id, mark] of Object.entries(progress.mastery)) if (byId.has(id)) events.push({ id, date: mark.at, mark: !!mark.value });
  events.sort((a, b) => a.date - b.date);
  const rows = new Map(), wrong = {}, review = {}, attempts = {};
  for (const e of events) {
    if (e.mark !== undefined) {
      if (!wrong[e.id]) continue;
      if (e.mark) delete review[e.id];
      else review[e.id] = { stage: 0, due: startOfDay(e.date) };
      continue;
    }
    const correct = e.key ? isCorrect(e.answer, e.key) : null;
    rows.set(e.row, { key: e.key, correct });
    if (correct === null) continue;
    (attempts[e.id] ||= []).push({ date: e.date, correct });
    if (!correct) {
      const w = wrong[e.id] ||= { count: 0 };
      Object.assign(w, { answer: e.answer, key: e.key, count: w.count + 1, lastWrong: e.date });
      review[e.id] = { stage: 0, due: startOfDay(e.date) + REVIEW_INTERVALS[0] * DAY };
    } else if (review[e.id]) {
      const stage = review[e.id].stage + 1;
      if (stage >= REVIEW_INTERVALS.length) delete review[e.id];
      else review[e.id] = { stage, due: startOfDay(e.date) + REVIEW_INTERVALS[stage] * DAY };
    }
  }
  for (const [id, w] of Object.entries(wrong)) w.mastered = !review[id];
  return { rows, wrong, review, attempts };
}

/** Review load for the coming days: [{day (start-of-day ms), count}] with overdue items folded into today. */
function reviewForecast(review, now = Date.now(), days = 7) {
  const today = startOfDay(now);
  return Array.from({ length: days }, (_, i) => {
    const day = today + i * DAY;
    const count = Object.values(review).filter(r => (i === 0 ? r.due < day + DAY : r.due >= day && r.due < day + DAY)).length;
    return { day, count };
  });
}

function dueToday(review, now = Date.now()) {
  const end = startOfDay(now) + DAY;
  return Object.entries(review).filter(([, r]) => r.due < end).sort((a, b) => a[1].due - b[1].due).map(([id]) => id);
}

/** Per-category numbers, weakest first. */
function categoryStats(bank, analysis) {
  const stats = new Map(bank.categories.map(c => [c, { category: c, total: 0, practiced: 0, attempts: 0, correct: 0, activeWrong: 0 }]));
  for (const q of bank.questions) {
    const s = stats.get(q.category);
    s.total++;
    const a = analysis.attempts[q.id];
    if (a) { s.practiced++; s.attempts += a.length; s.correct += a.filter(x => x.correct).length; }
    if (analysis.wrong[q.id] && !analysis.wrong[q.id].mastered) s.activeWrong++;
  }
  return [...stats.values()]
    .map(s => ({ ...s, accuracy: s.attempts ? s.correct / s.attempts : null }))
    .sort((a, b) => (a.accuracy ?? 2) - (b.accuracy ?? 2) || b.activeWrong - a.activeWrong);
}

/** Consecutive days (ending today or yesterday) with at least one submitted session. */
function studyStreak(progress, now = Date.now()) {
  const days = new Set(progress.history.map(h => startOfDay(h.date)));
  let day = startOfDay(now);
  if (!days.has(day)) day -= DAY;
  let n = 0;
  while (days.has(day)) { n++; day -= DAY; }
  return n;
}

/** Picks up to `size` questions; unpractised questions first when preferNew. */
function pickQuestions(pool, size, analysis, preferNew, random = Math.random) {
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
  if (preferNew) shuffled.sort((a, b) => !!analysis.attempts[a.id] - !!analysis.attempts[b.id]);
  return shuffled.slice(0, size);
}
