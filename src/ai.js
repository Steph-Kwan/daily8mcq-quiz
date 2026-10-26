'use strict';
// AI tutor on the learner's own OpenAI API key (or any OpenAI-compatible endpoint): explains mistakes and drafts a
// review plan. Uses Chat Completions, which compatible providers also implement. Needs src/vendor/openai.js.

const DEFAULT_AI_MODEL = 'gpt-5.5';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const API_KEY_SECRET = 'openai-api-key';
const MAX_IMAGE_EDGE = 1568;

class AiError extends Error {
  constructor(message, { cancelled = false } = {}) { super(message); this.cancelled = cancelled; }
}

const aiModel = () => settings.ai?.model?.trim() || DEFAULT_AI_MODEL;
const aiBaseURL = () => settings.ai?.baseURL?.trim().replace(/\/+$/, '') || DEFAULT_BASE_URL;
const aiSendsImages = () => settings.ai?.images !== false;

function aiClient() {
  const apiKey = appSecrets.get(API_KEY_SECRET);
  if (!apiKey) throw new AiError(t('还没有设置 API Key。请到「设置 → AI 讲解」里填写。'));
  // The key belongs to the person using this copy of the app; it is only sent to the endpoint they configured.
  return new OpenAI({ apiKey, baseURL: aiBaseURL(), dangerouslyAllowBrowser: true, fetch: appFetch });
}

function explainAiError(err) {
  if (err instanceof AiError) return err;
  if (err instanceof OpenAI.APIUserAbortError) return new AiError(t('已停止'), { cancelled: true });
  if (err instanceof OpenAI.AuthenticationError) return new AiError(t('API Key 无效，请到设置里检查。'));
  if (err instanceof OpenAI.PermissionDeniedError) return new AiError(t('这个 API Key 没有权限使用所选模型。'));
  if (err instanceof OpenAI.NotFoundError) return new AiError(t('找不到所选模型或接口地址不对，请到设置里检查。'));
  if (err instanceof OpenAI.RateLimitError) return new AiError(t('请求太频繁或额度已用完，请稍后再试。'));
  if (err instanceof OpenAI.BadRequestError) return new AiError(t('请求被拒绝：{msg}', { msg: err.message }) + (aiSendsImages() ? ' ' + t('如果所选模型不支持图片，可以在设置里关闭「发送题目图片」。') : ''));
  if (err instanceof OpenAI.APIConnectionError) return new AiError(t('无法连接到 {host}，请检查网络和接口地址。', { host: new URL(aiBaseURL()).host }));
  if (err instanceof OpenAI.APIError) return new AiError(t('AI 服务出错（{status}），请稍后再试。', { status: err.status ?? '?' }));
  return new AiError(err?.message || String(err));
}

/** Lists the models the endpoint offers (no tokens used); returns { ids, found } for the configured model. */
async function testAiConnection() {
  try {
    const ids = [];
    for await (const m of aiClient().models.list()) ids.push(m.id);
    ids.sort();
    return { ids, found: ids.includes(aiModel()) };
  } catch (err) { throw explainAiError(err); }
}

async function imageBlock(blob) {
  const supported = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(Error('image')); i.src = url; });
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    let out = blob;
    if (scale < 1 || !supported.includes(blob.type) || blob.size > 3.5e6) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      out = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.9));
    }
    const data = await new Promise(resolve => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result).split(',')[1]); fr.readAsDataURL(out); });
    return { type: 'image_url', image_url: { url: `data:${out.type};base64,${data}` } };
  } finally { URL.revokeObjectURL(url); }
}

/** Streams one request; onText receives the text so far. Returns { text, model }. */
async function streamAi({ system, content, onText, signal }) {
  let client;
  try { client = aiClient(); } catch (err) { throw explainAiError(err); }
  try {
    const stream = await client.chat.completions.create({
      model: aiModel(),
      messages: [{ role: 'system', content: system }, { role: 'user', content }],
      stream: true,
    }, { signal });
    let text = '', refusal = '', finish = null, model = aiModel();
    for await (const chunk of stream) {
      model = chunk.model || model;
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      if (choice.delta?.content) { text += choice.delta.content; onText?.(text); }
      if (choice.delta?.refusal) refusal += choice.delta.refusal;
      finish = choice.finish_reason || finish;
    }
    // The SDK ends the stream quietly when the request is aborted.
    if (signal?.aborted) throw new AiError(t('已停止'), { cancelled: true });
    if (refusal || finish === 'content_filter') throw new AiError(t('AI 拒绝回答这道题。') + (refusal ? ' ' + refusal : ''));
    if (!text.trim()) throw new AiError(t('AI 没有返回内容，请换个模型再试。'));
    return { text: text + (finish === 'length' ? '\n\n' + t('（回答过长，已被截断）') : ''), model };
  } catch (err) { throw signal?.aborted ? new AiError(t('已停止'), { cancelled: true }) : explainAiError(err); }
}

const replyLanguage = () => (interfaceLanguage === 'en' ? 'English' : '简体中文');

function describeQuestion(q) {
  const lines = [`${t('题型')}：${t(typeLabel(q.type))}`, `${t('分类')}：${q.category}`];
  if (q.source) lines.push(`${t('来源')}：${q.source}`);
  lines.push(`${t('题目')}：${q.text || t('（见图片）')}`);
  for (const o of q.options) lines.push(`${o.key}. ${o.text || (o.image ? t('（见选项图片）') : t('（见题目图片）'))}`);
  return lines.join('\n');
}

async function questionImages(q) {
  const names = [...q.images, ...q.options.map(o => o.image).filter(Boolean)];
  const blocks = [];
  for (const name of names) {
    const blob = await bankStore.asset(bank.id, name);
    if (blob) blocks.push(await imageBlock(blob));
  }
  return blocks;
}

async function explainMistake(q, userAnswer, { onText, signal }) {
  const system = `You are a patient, encouraging tutor helping a student correct a multiple-choice question they practised. Reply in ${replyLanguage()} using Markdown with short sections. Be accurate and concise (about 150–350 words). If the question depends on an image, read the image carefully. If the official answer looks wrong to you, say so politely and explain why, but still explain the official answer.`;
  const parts = [
    describeQuestion(q),
    `${t('标准答案')}：${[...q.answer].join(', ')}`,
    userAnswer && userAnswer !== q.answer ? `${t('学生的答案')}：${[...userAnswer].join(', ')}` : t('学生答对了这题，但想弄懂它。'),
  ];
  if (q.explanation) parts.push(`${t('题库自带解析')}：${q.explanation}`);
  parts.push(interfaceLanguage === 'en'
    ? 'Please cover: 1) why the correct answer is right; 2) what is wrong with the student\'s choice (and each other option, briefly); 3) the key concept being tested; 4) one tip to avoid this mistake next time.'
    : '请包括：1）正确答案为什么对；2）学生选的答案错在哪里（其他选项也简要说明）；3）这题考的核心知识点；4）一个下次避免出错的小技巧。');
  const content = [...(aiSendsImages() ? await questionImages(q) : []), { type: 'text', text: parts.join('\n\n') }];
  return streamAi({ system, content, onText, signal });
}

async function draftReviewPlan(summary, { onText, signal }) {
  const system = `You are a study coach. From the learner's practice statistics, write a realistic, specific review plan in ${replyLanguage()} using Markdown (headings, short lists, and a day-by-day table). Prioritise weak categories and questions that are due for spaced review, respect the daily time budget, and keep the plan achievable. Base everything on the numbers given; do not invent statistics.`;
  return streamAi({ system, content: summary, onText, signal });
}

// ---- Markdown (subset) to safe HTML ----

function renderMarkdown(md) {
  const inline = s => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  const lines = String(md).replace(/\r/g, '').split('\n'), out = [];
  let list = null, para = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flushPara(); flushList();
      const code = [];
      while (++i < lines.length && !/^```/.test(lines[i])) code.push(lines[i]);
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
    } else if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      flushPara(); flushList();
      const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = cells(line); i++;
      const body = [];
      while (i + 1 < lines.length && /^\s*\|.*\|\s*$/.test(lines[i + 1])) body.push(cells(lines[++i]));
      out.push(`<div class="table-wrap"><table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    } else if (/^#{1,6}\s/.test(line)) {
      flushPara(); flushList();
      const level = Math.min(6, line.match(/^#+/)[0].length + 2);
      out.push(`<h${level}>${inline(line.replace(/^#+\s*/, ''))}</h${level}>`);
    } else if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      flushPara();
      const tag = /^\s*\d/.test(line) ? 'ol' : 'ul';
      if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push(line.replace(/^\s*([-*+]|\d+[.)])\s+/, ''));
    } else if (/^\s*(---|\*\*\*)\s*$/.test(line)) { flushPara(); flushList(); out.push('<hr>'); }
    else if (!line.trim()) { flushPara(); flushList(); }
    else { flushList(); para.push(line); }
  }
  flushPara(); flushList();
  return out.join('');
}
