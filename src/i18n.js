'use strict';
// UI strings are written in Chinese and looked up in EN_STRINGS (src/i18n-en.js) when the interface is in English.
// Placeholders: t('已答 {a} / {n}', { a: 1, n: 8 }).

const EN_STRINGS = {};

let interfaceLanguage = (() => {
  try {
    const saved = JSON.parse(appStore.get('daily8.settings') || '{}').lang;
    if (saved === 'zh' || saved === 'en') return saved;
  } catch {}
  // Chinese if it is anywhere in the user's preferred languages (many Chinese speakers run an English system).
  // WKWebView only reports the first system language, so the app passes the full list.
  const preferred = window.__DAILY8_NATIVE__?.languages || (navigator.languages?.length ? navigator.languages : [navigator.language || 'zh']);
  return preferred.some(l => /^zh\b/i.test(l)) ? 'zh' : 'en';
})();

function t(text, params) {
  let s = interfaceLanguage === 'en' ? EN_STRINGS[text] ?? text : text;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
  return s;
}
