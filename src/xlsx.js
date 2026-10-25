'use strict';
// Minimal .xlsx / .csv reader: cell text of every sheet, plus pictures pasted onto a sheet (with the cell they are anchored to).
// Needs fflate.unzipSync (src/vendor/fflate.js).

const xmlEntities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(text) {
  return text
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) =>
      e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : xmlEntities[e.toLowerCase()])
    .replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function xmlAttrs(tag) {
  const attrs = {};
  for (const m of tag.matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)) attrs[m[1]] = decodeXml(m[2]);
  return attrs;
}

/** Concatenated text of all <t> runs, skipping phonetic hints. */
function runText(xml) {
  return [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)]
    .map(m => decodeXml(m[1] || '')).join('');
}

/** "AB12" -> { col: 27, row: 11 } (both 0-based). */
function cellRef(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref || '');
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + ch.charCodeAt(0) - 64;
  return { col: col - 1, row: +m[2] - 1 };
}

function resolvePath(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

function readRels(files, path) {
  const relsPath = path.replace(/([^/]+)$/, '_rels/$1.rels');
  const xml = files[relsPath] ? fflate.strFromU8(files[relsPath]) : '';
  const rels = {};
  for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const a = xmlAttrs(m[0]);
    rels[a.Id] = { target: a.TargetMode === 'External' ? null : resolvePath(path, a.Target), type: a.Type || '' };
  }
  return rels;
}

function readSheetCells(xml, shared) {
  const rows = [];
  for (const c of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const a = xmlAttrs(c[1]), pos = cellRef(a.r), body = c[2] || '';
    if (!pos) continue;
    const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body);
    let value;
    if (a.t === 's') value = v ? shared[+v[1]] ?? '' : '';
    else if (a.t === 'inlineStr') value = runText(body);
    else if (a.t === 'b') value = v ? (v[1] === '1' ? 'TRUE' : 'FALSE') : '';
    else value = v ? decodeXml(v[1]) : '';
    (rows[pos.row] ||= [])[pos.col] = value;
  }
  return Array.from(rows, r => Array.from(r || [], x => (x ?? '').toString()));
}

function readSheetPictures(files, sheetPath, sheetXml) {
  const pictures = [], sheetRels = readRels(files, sheetPath);
  for (const d of sheetXml.matchAll(/<drawing\b[^>]*r:id="([^"]+)"/g)) {
    const drawingPath = sheetRels[d[1]]?.target;
    if (!drawingPath || !files[drawingPath]) continue;
    const drawingRels = readRels(files, drawingPath), xml = fflate.strFromU8(files[drawingPath]);
    for (const anchor of xml.matchAll(/<xdr:(?:twoCellAnchor|oneCellAnchor|absoluteAnchor)\b[\s\S]*?<\/xdr:(?:twoCellAnchor|oneCellAnchor|absoluteAnchor)>/g)) {
      const from = /<xdr:from>[\s\S]*?<xdr:col>(\d+)<\/xdr:col>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/.exec(anchor[0]);
      for (const blip of anchor[0].matchAll(/<a:blip\b[^>]*r:embed="([^"]+)"/g)) {
        const mediaPath = drawingRels[blip[1]]?.target;
        if (from && mediaPath && files[mediaPath]) pictures.push({ row: +from[2], col: +from[1], name: mediaPath.split('/').pop(), data: files[mediaPath] });
      }
    }
  }
  return pictures;
}

/** Returns [{ name, rows: string[][], pictures: [{row, col, name, data: Uint8Array}] }] in workbook order. */
function readXlsx(bytes) {
  const files = fflate.unzipSync(bytes);
  if (!files['xl/workbook.xml']) throw Error('不是有效的 Excel（.xlsx）文件');
  const shared = [];
  if (files['xl/sharedStrings.xml']) {
    for (const si of fflate.strFromU8(files['xl/sharedStrings.xml']).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) shared.push(runText(si[1]));
  }
  const rels = readRels(files, 'xl/workbook.xml'), sheets = [];
  for (const m of fflate.strFromU8(files['xl/workbook.xml']).matchAll(/<sheet\b[^>]*>/g)) {
    const a = xmlAttrs(m[0]), path = rels[a['r:id']]?.target;
    if (!path || !files[path]) continue;
    const xml = fflate.strFromU8(files[path]);
    sheets.push({ name: a.name, rows: readSheetCells(xml, shared), pictures: readSheetPictures(files, path, xml) });
  }
  return sheets;
}

/** RFC 4180 CSV (comma, or tab for .tsv); returns string[][]. */
function readCsv(text, delimiter = ',') {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === delimiter) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
