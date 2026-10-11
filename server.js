import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, 'data', 'state.json');
const HISTORY_URLS = [
  'https://draw.ar-lottery01.com/WinGo/WinGo_30S/GetHistoryIssuePage.json?pageNo=1&pageSize=100',
  'https://draw.ar-lottery06.com/WinGo/WinGo_30S/GetHistoryIssuePage.json?pageNo=1&pageSize=100'
];
app.use(express.static(path.join(__dirname, 'public')));

function readState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { predictions: [], settled: [], updatedAt: null }; } }
function writeState(s) { try { fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); } catch (e) { console.error('Persistence unavailable:', e.message); } }
function normalize(x) {
  const number = Number(x?.number), issue = String(x?.issueNumber ?? x?.issue ?? '');
  if (!Number.isInteger(number) || number < 0 || number > 9 || !issue) return null;
  let rawColor = String(x?.color ?? '').toLowerCase();
  if (!rawColor) rawColor = number === 0 || number === 5 ? 'violet' : (number % 2 ? 'green' : 'red');
  const color = rawColor.includes('green') ? 'Green' : rawColor.includes('red') ? 'Red' : rawColor.includes('violet') || rawColor.includes('purple') ? 'Violet' : rawColor;
  return { issue, number, size: number >= 5 ? 'Big' : 'Small', color };
}
async function getHistory() {
  let lastError = 'No history source responded';
  for (const url of HISTORY_URLS) {
    try {
      const r = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'WingoLast10Analyzer/1.0' }, signal: AbortSignal.timeout(9000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = await r.json();
      const raw = body?.data?.list ?? body?.data?.records ?? body?.list ?? [];
      const items = raw.map(normalize).filter(Boolean);
      if (!items.length) throw new Error('API returned no recognizable results');
      return items.slice(0, 10);
    } catch (e) { lastError = e.message; }
  }
  throw new Error(lastError);
}
function freq(items, key) { const counts = {}; for (const x of items) counts[x[key]] = (counts[x[key]] || 0) + 1; const entries = Object.entries(counts).sort((a,b) => b[1]-a[1] || String(a[0]).localeCompare(String(b[0]))); return { counts, top: entries[0]?.[0] ?? null, tied: entries.length > 1 && entries[0][1] === entries[1][1] }; }
function pick(value, counts, n) { return { value, occurrences: counts[value] || 0, outOf: n, confidence: Math.round((counts[value] || 0) / n * 100), note: `${counts[value] || 0} of ${n} in sample` }; }
function predict(history) {
  const sample = history.slice(0, 10);
  if (sample.length < 3) return { ready: false, sampleSize: sample.length, message: 'Waiting for at least 3 valid results.' };
  const nf = freq(sample, 'number'), sf = freq(sample, 'size'), cf = freq(sample, 'color');
  return { ready: true, sampleSize: sample.length, basedOn: sample.map(x => x.issue), generatedAt: new Date().toISOString(), predictions: {
    number: pick(Number(nf.top), nf.counts, sample.length),
    size: pick(sf.top, sf.counts, sample.length),
    color: pick(cf.top, cf.counts, sample.length)
  }, disclaimer: 'Pattern estimate only. Wingo outcomes may be random; sample frequency is not a probability guarantee.' };
}
function settle(state, history) {
  const byIssue = new Map(history.map(x => [x.issue, x]));
  for (const p of state.predictions) {
    if (p.status !== 'pending') continue;
    const actual = byIssue.get(p.targetIssue); if (!actual) continue;
    p.status = 'settled'; p.actual = { number: actual.number, size: actual.size, color: actual.color };
    p.correct = { number: Number(p.number) === actual.number, size: p.size === actual.size, color: String(p.color).toLowerCase() === String(actual.color).toLowerCase() };
    p.settledAt = new Date().toISOString(); state.settled.unshift(p);
  }
  state.predictions = state.predictions.filter(p => p.status === 'pending').slice(-100);
  state.settled = (state.settled || []).slice(0, 300);
}
function accuracy(state) {
  const all = state.settled || [];
  const one = key => { const tested = all.filter(p => typeof p.correct?.[key] === 'boolean'); const correct = tested.filter(p => p.correct[key]).length; return { correct, total: tested.length, percent: tested.length ? Math.round(correct / tested.length * 100) : null }; };
  return { number: one('number'), size: one('size'), color: one('color'), settledCount: all.length };
}
app.get('/api/health', (_req,res) => res.json({ ok: true, service: 'Wingo Last 10 AI' }));
app.get('/api/state', async (_req,res) => {
  try {
    const history = await getHistory(), state = readState(); settle(state, history);
    const prediction = predict(history), latest = history[0]?.issue;
    if (prediction.ready && latest && !state.predictions.some(p => p.sourceIssue === latest) && !state.settled.some(p => p.sourceIssue === latest) && /^\d+$/.test(latest)) {
      state.predictions.push({ sourceIssue: latest, targetIssue: String(BigInt(latest) + 1n), number: prediction.predictions.number.value, size: prediction.predictions.size.value, color: prediction.predictions.color.value, createdAt: new Date().toISOString(), status: 'pending' });
    }
    state.updatedAt = new Date().toISOString(); writeState(state);
    res.json({ ok: true, history, prediction, accuracy: accuracy(state), recentSettled: (state.settled || []).slice(0,30), updatedAt: state.updatedAt });
  } catch (e) { res.status(502).json({ ok: false, error: `Could not fetch live Wingo history: ${e.message}`, hint: 'The public source may be temporarily unavailable or may have changed.' }); }
});
app.get('/api/history', (_req,res) => { const s = readState(); res.json({ accuracy: accuracy(s), recentSettled: (s.settled || []).slice(0,100) }); });
app.listen(PORT, '0.0.0.0', () => console.log(`Wingo Last 10 AI listening on ${PORT}`));
