import test from 'node:test';
import assert from 'node:assert'; // loose deepEqual: values come from a VM context with its own prototypes
import fs from 'node:fs';
import { load, read, root } from './load.mjs';

const lib = load();
const images = () => fs.readdirSync(root + 'demo/images').filter(f => f.endsWith('.png')).map(name => ({ name, data: new Uint8Array(read('demo/images/' + name)) }));
const csv = text => [{ name: 'bank.csv', data: new TextEncoder().encode(text) }];
const HEAD = '编号,题型,分类,题目,A,B,C,D,答案,图片\n';

test('reads cells, sheets and pasted pictures from the demo workbook', () => {
  const sheets = lib.readXlsx(new Uint8Array(read('demo/demo.xlsx')));
  assert.deepEqual(sheets.map(s => s.name), ['题目', '设置']);
  assert.strictEqual(sheets[0].rows[0][3], '题目');
  assert.strictEqual(sheets[0].rows.length, 26);
  assert.deepEqual(sheets[0].pictures.map(p => [p.row, p.col]).sort(), [[13, 4], [13, 5], [13, 6], [13, 7], [20, 9]]);
});

test('a file re-saved by Microsoft Excel (shared strings) parses to the same bank', () => {
  const ours = lib.buildBank([{ name: 'demo.xlsx', data: new Uint8Array(read('demo/demo.xlsx')) }, ...images()]).bank;
  const excel = lib.buildBank([{ name: 'demo.xlsx', data: new Uint8Array(read('tests/fixtures/demo-saved-by-excel.xlsx')) }, ...images()]).bank;
  const shape = b => b.questions.map(q => [q.id, q.type, q.text, q.answer, q.category, q.options.map(o => o.text + (o.image ? '+img' : '')), q.images.length]);
  assert.deepEqual(shape(excel), shape(ours));
  assert.strictEqual(excel.title, '示例题库');
});

test('demo bank: every format feature comes through', () => {
  const zip = new Uint8Array(fs.readFileSync(root + 'build/demo.zip'));
  const { bank, errors, warnings, assets } = lib.buildBank([{ name: 'demo.zip', data: zip }]);
  assert.deepEqual([errors, warnings], [[], []]);
  assert.strictEqual(bank.questions.length, 25);
  assert.strictEqual(bank.id, lib.buildBank([{ name: 'other-name.zip', data: zip }]).bank.id, 'id comes from the 编号 setting, not the file name');
  assert.strictEqual(bank.sessionSize, 8);
  const q = id => bank.questions.find(x => x.id === id);
  assert.deepEqual(Object.fromEntries(['single', 'multiple', 'truefalse'].map(t => [t, bank.questions.filter(x => x.type === t).length])), { single: 16, multiple: 4, truefalse: 5 });
  assert.strictEqual(q('D03').answer, 'ACD');
  assert.deepEqual(q('D04').options.map(o => o.text), ['对', '错']);
  assert.strictEqual(q('D04').answer, 'A');
  assert.strictEqual(q('D16').answer, 'B');
  assert.strictEqual(q('D06').options.length, 2, 'only two option columns filled');
  assert.strictEqual(q('D14').text, '');
  assert.strictEqual(q('D14').options.length, 4, '选项数 for a screenshot question');
  assert.deepEqual(q('D05').images, ['flowchart.png']);
  assert.strictEqual(q('D20').images.length, 1, 'picture pasted on the row');
  assert.ok(q('D13').options.every(o => o.image && !o.text), 'pictures pasted into option cells');
  assert.ok([...assets.keys()].every(k => assets.get(k).data.length > 100));
  assert.deepEqual(bank.categories, ['计算机基础', '数学', '科学', '地理', '英语']);
});

test('validation: errors skip rows, warnings keep them, types are inferred', () => {
  const { bank, errors, warnings } = lib.buildBank(csv(HEAD + [
    '1,,c1,多个字母自动当多选,a,b,c,d,"A, c",',
    '2,,c1,对错自动当判断,,,,,错,',
    '3,单选,c1,单选却写了两个答案,a,b,c,d,AB,',
    '4,猜猜,c1,题型无法识别,a,b,c,d,A,',
    '5,单选,c1,答案超出选项,a,b,c,d,E,',
    '6,单选,c1,,,,,,A,',
    '1,单选,c1,编号重复,a,b,c,d,A,',
    '7,单选,,缺图片也能导入,a,b,c,d,b,nope.png',
    '8,单选,c2,没有答案,a,b,c,d,,',
    ',,,,,,,,,',
    '9,判断,c2,判断用 T,,,,,T,',
  ].join('\n')));
  assert.deepEqual(bank.questions.map(q => [q.id, q.type, q.answer]), [['1', 'multiple', 'AC'], ['2', 'truefalse', 'B'], ['7', 'single', 'B'], ['8', 'single', ''], ['9', 'truefalse', 'A']]);
  assert.deepEqual(errors.map(e => e.row), [4, 5, 6, 7, 8]);
  assert.match(errors.find(e => e.row === 8).message, /重复/);
  assert.deepEqual(warnings.map(w => w.row), [9, 10]);
  assert.strictEqual(bank.questions.find(q => q.id === '7').category, '未分类');
});

test('header detection accepts English names and option aliases; ids are stable without an id column', () => {
  const text = 'My bank\n\nquestion,option A,option B,Option C,answer,category\nWhat is 2+2?,3,4,5,b,Math\n';
  const a = lib.buildBank(csv(text)).bank, b = lib.buildBank(csv(text.replace('Math\n', 'Math\nNew row,1,2,3,a,Math\n'))).bank;
  assert.strictEqual(a.questions[0].answer, 'B');
  assert.strictEqual(a.questions[0].options.length, 3);
  assert.strictEqual(a.questions[0].id, b.questions[0].id);
});

test('clear errors for unusable input', () => {
  assert.throws(() => lib.buildBank([{ name: 'a.png', data: new Uint8Array(4) }]), /没有找到题库表格/);
  assert.throws(() => lib.buildBank(csv('foo,bar\n1,2\n')), /找不到表头/);
  assert.throws(() => lib.buildBank(csv(HEAD + '1,单选,c,,,,,,A,\n')), e => /没有可以导入的题目/.test(e.message) && e.errors.length === 1);
});

test('CSV quoting: commas, quotes and newlines inside fields', () => {
  assert.deepEqual(lib.readCsv('a,"b,1","say ""hi""","multi\nline"\r\nx,y\n'), [['a', 'b,1', 'say "hi"', 'multi\nline'], ['x', 'y']]);
});
