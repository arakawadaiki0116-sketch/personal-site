// シフト希望メモ用の中継役（Cloudflare Worker）
// GET /events?start=YYYY-MM-DD&days=7  （ヘッダー X-Key に合言葉）
// → { events: [{ summary, start:{dateTime|date}, end:{...}, color }] }
import { expandIcs } from './expand.js';

const COLORS = ['#1f8ad6', '#0b8043', '#d50000', '#f09300', '#8e24aa', '#616161'];

function cors(origin, env) {
  const allowed = String(env.ALLOWED_ORIGINS || '').split(/[\s,]+/).filter(Boolean);
  const h = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'X-Key',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
  if (origin && allowed.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }
  });
}

// 合言葉の比較（文字ごとの時間差で推測されないようにする）
function sameKey(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !b) return false;
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] || 0) ^ (eb[i] || 0);
  return diff === 0;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const ch = cors(origin, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: ch });

    const url = new URL(request.url);
    if (request.method !== 'GET' || url.pathname !== '/events') return json({ error: 'not_found' }, 404, ch);
    if (!sameKey(request.headers.get('X-Key'), env.ACCESS_KEY)) return json({ error: 'bad_key' }, 401, ch);

    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(url.searchParams.get('start') || '');
    if (!m) return json({ error: 'bad_start' }, 400, ch);
    const days = Math.min(14, Math.max(1, parseInt(url.searchParams.get('days') || '7', 10) || 7));
    const fromMs = Date.UTC(+m[1], +m[2] - 1, +m[3]) - 9 * 3600e3; // 日本時間の 0:00
    const toMs = fromMs + days * 86400e3;

    const sources = String(env.ICS_URLS || '').split(/\s+/).filter(Boolean);
    if (!sources.length) return json({ error: 'not_configured' }, 503, ch);

    const results = await Promise.all(sources.map(async (src, i) => {
      try {
        const res = await fetch(src, { cf: { cacheTtl: 300, cacheEverything: true } });
        if (!res.ok) return { failed: true };
        const events = expandIcs(await res.text(), fromMs, toMs);
        return { events: events.map((e) => ({ ...e, color: COLORS[i % COLORS.length] })) };
      } catch {
        return { failed: true };
      }
    }));

    if (results.every((r) => r.failed)) return json({ error: 'fetch_failed' }, 502, ch);
    const events = results.flatMap((r) => r.events || []);
    return json({ events, partial: results.some((r) => r.failed) }, 200, ch);
  }
};
