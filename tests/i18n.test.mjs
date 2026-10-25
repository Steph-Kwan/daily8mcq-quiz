import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';
import { strings } from '../scripts/i18n_strings.mjs';
import { root } from './load.mjs';

test('every UI string has an English translation with the same placeholders', () => {
  const ctx = vm.createContext({});
  vm.runInContext('var EN_STRINGS = {};' + fs.readFileSync(root + 'src/i18n-en.js', 'utf8').replace("'use strict';", '') + ';this.EN = EN_STRINGS', ctx);
  const missing = strings.filter(s => !(s in ctx.EN));
  assert.deepEqual(missing, [], 'add these to src/i18n-en.js');
  const holes = s => (s.match(/\{\w+\}/g) || []).sort().join();
  assert.deepEqual(strings.filter(s => holes(s) !== holes(ctx.EN[s])), [], 'placeholder mismatch');
});
