import test from 'node:test';
import assert from 'node:assert'; // loose deepEqual: values come from a VM context with its own prototypes
import { load } from './load.mjs';

const lib = load();
const D = lib.DAY, day0 = new Date(2026, 0, 5, 10).getTime();
const bank = {
  categories: ['x', 'y'],
  questions: [
    { id: 'q1', category: 'x', answer: 'A', type: 'single' },
    { id: 'q2', category: 'x', answer: 'AC', type: 'multiple' },
    { id: 'q3', category: 'y', answer: 'B', type: 'truefalse' },
    { id: 'q4', category: 'y', answer: '', type: 'single' },
  ],
};
const session = (date, rows) => ({ date, rows: rows.map(([id, answer]) => ({ id, answer })) });
const progress = history => ({ ...lib.emptyProgress(), history: history.reverse() });

test('grading: multiple choice must match exactly; questions without a key are not graded', () => {
  const p = progress([session(day0, [['q1', 'A'], ['q2', 'A'], ['q4', 'B']])]);
  const a = lib.analyze(bank, p);
  assert.deepEqual(p.history[0].rows.map(r => a.rows.get(r).correct), [true, false, null]);
  assert.deepEqual(Object.keys(a.wrong), ['q2']);
});

test('spaced review: 1, 3, 7, 14 days, then mastered; a new mistake restarts', () => {
  const s = lib.startOfDay(day0);
  let history = [session(day0, [['q1', 'B']])];
  let a = lib.analyze(bank, progress([...history]));
  assert.deepEqual(a.review.q1, { stage: 0, due: s + D });
  assert.deepEqual(lib.dueToday(a.review, day0), []);
  assert.deepEqual(lib.dueToday(a.review, day0 + D), ['q1']);
  const steps = [[1, 1, 3], [4, 2, 7], [11, 3, 14]];
  for (const [offset, stage, gap] of steps) {
    history.push(session(day0 + offset * D, [['q1', 'A']]));
    a = lib.analyze(bank, progress([...history]));
    assert.deepEqual(a.review.q1, { stage, due: s + (offset + gap) * D }, `after day ${offset}`);
    assert.strictEqual(a.wrong.q1.mastered, false);
  }
  history.push(session(day0 + 25 * D, [['q1', 'A']]));
  a = lib.analyze(bank, progress([...history]));
  assert.strictEqual(a.review.q1, undefined);
  assert.strictEqual(a.wrong.q1.mastered, true);
  history.push(session(day0 + 30 * D, [['q1', 'C']]));
  a = lib.analyze(bank, progress([...history]));
  assert.deepEqual([a.review.q1.stage, a.wrong.q1.count, a.wrong.q1.mastered], [0, 2, false]);
});

test('manual marks sit on the timeline: mastered leaves review; a later mistake brings it back', () => {
  const p = progress([session(day0, [['q3', 'A']])]);
  p.mastery.q3 = { value: true, at: day0 + 1000 };
  assert.strictEqual(lib.analyze(bank, p).wrong.q3.mastered, true);
  p.mastery.q3 = { value: false, at: day0 + 2000 };
  assert.strictEqual(lib.analyze(bank, p).review.q3.due, lib.startOfDay(day0), 'review again: due today');
  p.mastery.q3 = { value: true, at: day0 + 1000 };
  p.history.unshift(session(day0 + D, [['q3', 'A']]));
  assert.strictEqual(lib.analyze(bank, p).wrong.q3.mastered, false);
});

test('forecast folds overdue items into today; category stats sort weakest first; streak', () => {
  const p = progress([session(day0 - 3 * D, [['q1', 'B'], ['q3', 'A']]), session(day0, [['q2', 'C'], ['q3', 'A']])]);
  const a = lib.analyze(bank, p);
  assert.deepEqual(lib.reviewForecast(a.review, day0, 3).map(f => f.count), [1, 2, 0]);
  const stats = lib.categoryStats(bank, a);
  assert.deepEqual(stats.map(s => [s.category, s.attempts, s.correct, s.activeWrong]), [['x', 2, 0, 2], ['y', 2, 0, 1]], 'tie on accuracy: more open mistakes first');
  assert.strictEqual(lib.studyStreak(p, day0), 1);
  assert.strictEqual(lib.studyStreak(progress([session(day0 - D, []), session(day0 - 2 * D, [])]), day0), 2);
});

test('pickQuestions prefers unpractised questions and never exceeds the pool', () => {
  const a = lib.analyze(bank, progress([session(day0, [['q1', 'A'], ['q2', 'AC']])]));
  for (let i = 0; i < 20; i++) assert.strictEqual(lib.pickQuestions(bank.questions, 1, a, true)[0].id.match(/q[34]/) !== null, true);
  assert.strictEqual(lib.pickQuestions(bank.questions, 10, a, false).length, 4);
});

test('restored progress is validated; drafts that point at removed questions are dropped', () => {
  assert.throws(() => lib.normalizeProgress({ history: 'x' }, bank));
  const p = lib.normalizeProgress({ history: [], notes: {}, mastery: {}, draft: { ids: ['gone'], answers: {} } }, bank);
  assert.strictEqual(p.draft, null);
  assert.deepEqual(p.ai, { explanations: {}, plan: null });
});
