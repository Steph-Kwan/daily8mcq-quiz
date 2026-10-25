'use strict';
// Question banks: turning a spreadsheet (+ images) into a bank, and keeping banks in IndexedDB.
// Format reference: docs/题库格式.md

const FIELD_HEADERS = {
  id: ['id', '编号', '题号', '序号'],
  type: ['type', '题型', '类型'],
  text: ['question', 'text', '题目', '题干', '问题'],
  images: ['image', 'images', '图片', '配图', '题图'],
  answer: ['answer', 'key', '答案', '正确答案'],
  category: ['category', 'topic', '分类', '知识点', '章节', '主题', '题型分类'],
  source: ['source', '来源', '出处', '年份'],
  difficulty: ['difficulty', '难度'],
  explanation: ['explanation', '解析', '说明', '答案解析'],
  tags: ['tags', '标签'],
  optionCount: ['option_count', 'options', '选项数', '选项数量'],
};
const SETTING_KEYS = { id: ['id', '编号'], title: ['title', 'name', '名称', '题库名称', '标题'], description: ['description', '简介', '说明', '描述'], sessionSize: ['session_size', '每轮题数', '每次题数'] };
const QUESTION_SHEETS = ['题目', '题库', 'questions', 'question', 'bank'];
const SETTINGS_SHEETS = ['设置', '信息', 'info', 'settings'];
const TYPE_WORDS = {
  single: ['single', '单选', '单选题', '单项选择', '单项选择题', '选择题'],
  multiple: ['multiple', 'multi', '多选', '多选题', '多项选择', '多项选择题', '不定项', '不定项选择'],
  truefalse: ['truefalse', 'true/false', 'tf', 'judge', '判断', '判断题', '是非', '是非题', '对错'],
};
const TRUE_WORDS = ['对', '正确', '是', '√', '✓', 'T', 'TRUE', 'Y', 'YES', 'A'];
const FALSE_WORDS = ['错', '错误', '否', '×', '✗', 'X', 'F', 'FALSE', 'N', 'NO', 'B'];
const LETTERS = 'ABCDEF';
const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };

const normHeader = s => String(s ?? '').trim().toLowerCase().replace(/[\s_\-（）()：:]/g, '');
const baseName = p => String(p).split(/[\\/]/).pop();
const extOf = p => (/\.([a-z0-9]+)$/i.exec(p)?.[1] || '').toLowerCase();

function hashText(text) {
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619);
    b = Math.imul(b ^ c, 2246822519) + i;
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}

function matchWord(value, table) {
  const v = normHeader(value);
  return Object.keys(table).find(k => table[k].some(w => normHeader(w) === v));
}

function optionColumn(header) {
  const m = /^(?:选项|option)?([a-f])(?:选项)?$/i.exec(normHeader(header));
  return m ? m[1].toUpperCase() : null;
}

/** Finds the header row (within the first 10 rows) and maps field -> column index. */
function mapHeader(rows) {
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const cols = {}, options = {};
    (rows[r] || []).forEach((h, c) => {
      const opt = optionColumn(h);
      if (opt) { options[opt] ??= c; return; }
      const key = Object.keys(FIELD_HEADERS).find(k => FIELD_HEADERS[k].some(w => normHeader(w) === normHeader(h)));
      if (key && cols[key] === undefined) cols[key] = c;
    });
    if (cols.answer !== undefined && (cols.text !== undefined || cols.images !== undefined || Object.keys(options).length)) return { row: r, cols, options };
  }
  return null;
}

function readSettings(rows) {
  const out = {};
  for (const [k, v] of rows) {
    const key = Object.keys(SETTING_KEYS).find(f => SETTING_KEYS[f].some(w => normHeader(w) === normHeader(k)));
    if (key && String(v ?? '').trim()) out[key] = String(v).trim();
  }
  return out;
}

function parseAnswer(raw, type, count) {
  const value = String(raw ?? '').trim().toUpperCase();
  if (!value) return '';
  if (type === 'truefalse') {
    if (TRUE_WORDS.includes(value)) return 'A';
    if (FALSE_WORDS.includes(value)) return 'B';
    return null;
  }
  const letters = value.replace(/[\s,，、;；/|和及]/g, '');
  if (!/^[A-F]+$/.test(letters)) return null;
  const set = [...new Set(letters)].sort().join('');
  if ([...set].some(l => LETTERS.indexOf(l) >= count)) return null;
  if (type === 'single' && set.length !== 1) return null;
  return set;
}

/**
 * rows: string[][] of the question sheet; pictures: [{row, col, name, data}] anchored on it;
 * files: Map(lowercased base name -> {name, data, type}) of image files supplied with the sheet.
 * Returns { questions, assets: Map(name -> {data, type}), errors, warnings } — errors skip the row, warnings keep it.
 */
function parseQuestionRows(rows, pictures, files) {
  const header = mapHeader(rows);
  if (!header) throw Error(t('找不到表头。第一行需要包含「题目」（或「图片」）和「答案」等列名，可以参照模板。'));
  const { cols, options } = header;
  const cell = (row, key) => String(cols[key] === undefined ? '' : row[cols[key]] ?? '').trim();
  const optionLetters = Object.keys(options).sort();
  const questions = [], assets = new Map(), errors = [], warnings = [], seen = new Map();

  const byRow = new Map();
  for (const p of pictures) (byRow.get(p.row) || byRow.set(p.row, []).get(p.row)).push(p);
  const useFile = name => {
    const file = files.get(baseName(name).toLowerCase());
    if (!file) return null;
    assets.set(file.name, { data: file.data, type: file.type });
    return file.name;
  };
  const usePicture = p => {
    const name = `sheet-${p.row + 1}-${p.col + 1}-${p.name}`;
    assets.set(name, { data: p.data, type: IMAGE_TYPES[extOf(p.name)] || 'image/png' });
    return name;
  };

  for (let r = header.row + 1; r < rows.length; r++) {
    const row = rows[r] || [], line = r + 1;
    const anchored = byRow.get(r) || [];
    if (!row.some(v => String(v ?? '').trim()) && !anchored.length) continue;
    const problem = msg => errors.push({ row: line, message: msg });

    const images = [];
    for (const name of cell(row, 'images').split(/[;；,，\n]+/).map(s => s.trim()).filter(Boolean)) {
      const asset = useFile(name);
      if (asset) images.push(asset); else warnings.push({ row: line, message: t('找不到图片 {name}', { name }) });
    }
    const opts = optionLetters.map(key => {
      const text = String(row[options[key]] ?? '').trim();
      const image = text && IMAGE_TYPES[extOf(text)] && files.has(baseName(text).toLowerCase()) ? useFile(text) : null;
      return { key, text: image ? '' : text, image };
    });
    for (const p of anchored) {
      const opt = opts.find(o => options[o.key] === p.col);
      if (opt) opt.image = usePicture(p); else images.push(usePicture(p));
    }
    const lastFilled = opts.reduce((n, o, i) => (o.text || o.image ? i + 1 : n), 0);
    const declared = parseInt(cell(row, 'optionCount'), 10);

    let type = matchWord(cell(row, 'type'), TYPE_WORDS);
    if (cell(row, 'type') && !type) { problem(t('题型「{v}」无法识别，可填：单选、多选、判断', { v: cell(row, 'type') })); continue; }
    const rawAnswer = cell(row, 'answer');
    if (!type) {
      const upper = rawAnswer.toUpperCase();
      if (!lastFilled && [...TRUE_WORDS, ...FALSE_WORDS].filter(w => w.length > 1 || !/[A-F]/.test(w)).includes(upper)) type = 'truefalse';
      else type = upper.replace(/[^A-F]/g, '').length > 1 ? 'multiple' : 'single';
    }

    let choices;
    if (type === 'truefalse') choices = [{ key: 'A', text: opts[0]?.text || t('对'), image: opts[0]?.image || null }, { key: 'B', text: opts[1]?.text || t('错'), image: opts[1]?.image || null }];
    else {
      const count = Math.max(lastFilled, Number.isFinite(declared) ? Math.min(Math.max(declared, 2), 6) : lastFilled ? 0 : 4);
      if (count < 2) { problem(t('选项少于 2 个')); continue; }
      choices = Array.from({ length: count }, (_, i) => opts.find(o => o.key === LETTERS[i]) || { key: LETTERS[i], text: '', image: null });
    }

    const text = cell(row, 'text');
    if (!text && !images.length) { problem(t('没有题目内容（题目文字或图片至少要有一项）')); continue; }
    const answer = parseAnswer(rawAnswer, type, choices.length);
    if (answer === null) { problem(t('答案「{v}」不符合{type}的格式', { v: rawAnswer, type: t(typeLabel(type)) })); continue; }
    if (!answer) warnings.push({ row: line, message: t('没有填写答案，这题只能浏览，不会出现在练习里') });

    let id = cell(row, 'id') || 'h' + hashText([text, ...choices.map(c => c.text), ...images].join('\u0001'));
    if (seen.has(id)) {
      if (cell(row, 'id')) { problem(t('编号 {id} 与第 {row} 行重复', { id, row: seen.get(id) })); continue; }
      let n = 2; while (seen.has(`${id}-${n}`)) n++; id = `${id}-${n}`;
    }
    seen.set(id, line);
    questions.push({
      id, row: line, type, text, images, options: choices, answer,
      category: cell(row, 'category') || t('未分类'), source: cell(row, 'source'), difficulty: cell(row, 'difficulty'),
      explanation: cell(row, 'explanation'), tags: cell(row, 'tags').split(/[;；,，\s]+/).filter(Boolean),
    });
  }
  return { questions, assets, errors, warnings };
}

function typeLabel(type) { return { single: '单选题', multiple: '多选题', truefalse: '判断题' }[type]; }

/** entries: [{name, data: Uint8Array}] — any mix of one .xlsx/.csv/.tsv, image files, and .zip files containing them. */
function buildBank(entries) {
  const flat = [];
  for (const e of entries) {
    if (extOf(e.name) === 'zip') {
      for (const [path, data] of Object.entries(fflate.unzipSync(e.data))) {
        if (!path.endsWith('/') && !path.startsWith('__MACOSX/') && !baseName(path).startsWith('.')) flat.push({ name: path, data });
      }
    } else flat.push(e);
  }
  const sheets = flat.filter(e => ['xlsx', 'csv', 'tsv'].includes(extOf(e.name)) && !baseName(e.name).startsWith('~$'));
  if (!sheets.length) throw Error(t('没有找到题库表格。请选择 .xlsx 或 .csv 文件，或包含它的 .zip。'));
  const warnings = [];
  if (sheets.length > 1) warnings.push({ row: 0, message: t('找到多个表格，只导入了 {name}', { name: baseName(sheets[0].name) }) });
  const files = new Map();
  for (const e of flat) if (IMAGE_TYPES[extOf(e.name)]) files.set(baseName(e.name).toLowerCase(), { name: baseName(e.name), data: e.data, type: IMAGE_TYPES[extOf(e.name)] });

  const sheetFile = sheets[0], ext = extOf(sheetFile.name);
  let questionSheet, settings = {};
  if (ext === 'xlsx') {
    const book = readXlsx(sheetFile.data);
    const named = list => book.find(s => list.some(n => normHeader(n) === normHeader(s.name)));
    questionSheet = named(QUESTION_SHEETS) || book.find(s => mapHeader(s.rows)) || book[0];
    const settingsSheet = named(SETTINGS_SHEETS);
    if (settingsSheet) settings = readSettings(settingsSheet.rows);
  } else {
    questionSheet = { rows: readCsv(fflate.strFromU8(sheetFile.data), ext === 'tsv' ? '\t' : ','), pictures: [] };
  }
  const parsed = parseQuestionRows(questionSheet.rows, questionSheet.pictures, files);
  if (!parsed.questions.length) throw Object.assign(Error(t('没有可以导入的题目。')), { errors: parsed.errors });

  const title = settings.title || baseName(sheetFile.name).replace(/\.[^.]+$/, '');
  const size = parseInt(settings.sessionSize, 10);
  const bank = {
    id: 'b' + hashText(settings.id || title), title, description: settings.description || '',
    sessionSize: Number.isFinite(size) && size > 0 ? Math.min(size, 100) : 8,
    sourceFile: baseName(sheetFile.name), importedAt: Date.now(), questions: parsed.questions,
    categories: [...new Set(parsed.questions.map(q => q.category))],
  };
  return { bank, assets: parsed.assets, errors: parsed.errors, warnings: [...warnings, ...parsed.warnings] };
}

// ---- IndexedDB ----

let dbPromise;
function openDb() {
  return dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('daily8', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('banks', { keyPath: 'id' });
      req.result.createObjectStore('assets');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
}

async function idb(stores, mode, work) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result;
    Promise.resolve(work(tx)).then(r => { result = r; });
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(tx.error || Error('IndexedDB transaction failed'));
  });
}
const idbRequest = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
const assetRange = bankId => IDBKeyRange.bound([bankId], [bankId, []]);

const bankStore = {
  list: () => idb('banks', 'readonly', tx => idbRequest(tx.objectStore('banks').getAll())),
  get: id => idb('banks', 'readonly', tx => idbRequest(tx.objectStore('banks').get(id))),
  save: (bank, assets) => idb(['banks', 'assets'], 'readwrite', tx => {
    const store = tx.objectStore('assets');
    store.delete(assetRange(bank.id));
    for (const [name, a] of assets) store.put(new Blob([a.data], { type: a.type }), [bank.id, name]);
    tx.objectStore('banks').put(bank);
  }),
  remove: id => idb(['banks', 'assets'], 'readwrite', tx => {
    tx.objectStore('banks').delete(id);
    tx.objectStore('assets').delete(assetRange(id));
  }),
  asset: (bankId, name) => idb('assets', 'readonly', tx => idbRequest(tx.objectStore('assets').get([bankId, name]))),
};
