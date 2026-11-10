// シフト希望メモ用の中継役（Cloudflare Worker）
//
// GET  /config                 → { clientId }（ページが Google ログインに使う公開の値）
// POST /auth/google            { idToken, nonce } → { session, exp }（許可したアドレスだけ）
// GET  /events?start=YYYY-MM-DD&days=7   予定（要ログイン）
// GET  /state  / PUT /state    入力内容の読み書き（要ログイン。端末どうしで共有）
//
// ログインした証拠は「Authorization: Bearer <session>」で送る。
import { expandIcs } from './expand.js';
import { verifyGoogleIdToken, issueSession, readSession } from './auth.js';

const COLORS = ['#1f8ad6', '#0b8043', '#d50000', '#f09300', '#8e24aa', '#616161'];
const SESSION_TTL = 180 * 24 * 3600; // 通行証の有効期間：180日
const MAX_STATE_BYTES = 20000;

function cors(origin, env) {
  const allowed = String(env.ALLOWED_ORIGINS || '').split(/[\s,]+/).filter(Boolean);
  const h = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
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

async function googleJwks() {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/certs', { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!res.ok) throw new Error('jwks');
  return res.json();
}

async function currentUser(request, env) {
  const m = /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') || '');
  if (!m) return null;
  return readSession(m[1], env.SESSION_SECRET, env.ALLOWED_EMAIL);
}

async function handleEvents(url, ch, env) {
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
  return json({ events: results.flatMap((r) => r.events || []), partial: results.some((r) => r.failed) }, 200, ch);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const ch = cors(origin, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: ch });
    const url = new URL(request.url);
    const route = request.method + ' ' + url.pathname;

    if (route === 'GET /config') {
      return json({ clientId: env.GOOGLE_CLIENT_ID || '' }, 200, ch);
    }

    if (route === 'POST /auth/google') {
      if (!env.GOOGLE_CLIENT_ID || !env.ALLOWED_EMAIL || !env.SESSION_SECRET) return json({ error: 'not_configured' }, 503, ch);
      let body;
      try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400, ch); }
      try {
        const email = await verifyGoogleIdToken(body.idToken, {
          clientId: env.GOOGLE_CLIENT_ID, allowedEmail: env.ALLOWED_EMAIL, nonce: body.nonce, jwks: await googleJwks()
        });
        const s = await issueSession(email, SESSION_TTL, env.SESSION_SECRET);
        return json({ session: s.token, exp: s.exp }, 200, ch);
      } catch (e) {
        const reason = e && e.message === 'not_allowed' ? 'not_allowed' : 'bad_token';
        return json({ error: reason }, 403, ch);
      }
    }

    // ここから先はログインが必要
    const user = await currentUser(request, env);
    if (!user) return json({ error: 'login_required' }, 401, ch);

    if (route === 'GET /events') return handleEvents(url, ch, env);

    if (route === 'GET /state') {
      const saved = await env.STATE.get('state:' + user, 'json');
      return json(saved || { data: null, updatedAt: 0 }, 200, ch);
    }

    if (route === 'PUT /state') {
      const text = await request.text();
      if (text.length > MAX_STATE_BYTES) return json({ error: 'too_large' }, 413, ch);
      let body;
      try { body = JSON.parse(text); } catch { return json({ error: 'bad_request' }, 400, ch); }
      if (!body || typeof body.data !== 'object' || typeof body.updatedAt !== 'number') return json({ error: 'bad_request' }, 400, ch);
      const current = await env.STATE.get('state:' + user, 'json');
      if (current && current.updatedAt > body.updatedAt) return json(current, 409, ch); // 他の端末の方が新しい
      await env.STATE.put('state:' + user, JSON.stringify({ data: body.data, updatedAt: body.updatedAt }));
      return json({ ok: true, updatedAt: body.updatedAt }, 200, ch);
    }

    return json({ error: 'not_found' }, 404, ch);
  }
};
