// ログインまわり
// 1) Google が発行した ID トークン（「この人は誰か」の証明書）を確かめる
// 2) 確かめた人に、この中継役だけで通じる長持ちの通行証（セッショントークン）を渡す

const enc = new TextEncoder();

export function b64urlEncode(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64urlDecode(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (s.length % 4)) % 4;
  return Uint8Array.from(atob(s + '='.repeat(pad)), (c) => c.charCodeAt(0));
}
const decodeJson = (part) => JSON.parse(new TextDecoder().decode(b64urlDecode(part)));

// 文字ごとの時間差で推測されないように比べる
export function sameString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ea = enc.encode(a), eb = enc.encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] || 0) ^ (eb[i] || 0);
  return diff === 0;
}

const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

/**
 * Google の ID トークンを確かめ、許可したメールアドレスなら返す。だめなら Error を投げる。
 * @param {string} token
 * @param {{clientId:string, allowedEmail:string, nonce:string, jwks:{keys:object[]}, nowSec?:number}} opt
 */
export async function verifyGoogleIdToken(token, opt) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('malformed');
  const header = decodeJson(parts[0]);
  const payload = decodeJson(parts[1]);
  if (header.alg !== 'RS256') throw new Error('alg');

  const jwk = (opt.jwks.keys || []).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('kid');
  const key = await crypto.subtle.importKey(
    'jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key, b64urlDecode(parts[2]), enc.encode(parts[0] + '.' + parts[1])
  );
  if (!ok) throw new Error('signature');

  const now = opt.nowSec ?? Math.floor(Date.now() / 1000);
  if (!GOOGLE_ISSUERS.includes(payload.iss)) throw new Error('iss');
  if (payload.aud !== opt.clientId) throw new Error('aud');
  if (typeof payload.exp !== 'number' || payload.exp + 60 < now) throw new Error('expired');
  if (!opt.nonce || payload.nonce !== opt.nonce) throw new Error('nonce');
  if (payload.email_verified !== true && payload.email_verified !== 'true') throw new Error('unverified');
  const email = String(payload.email || '').toLowerCase();
  if (!email || email !== String(opt.allowedEmail || '').trim().toLowerCase()) throw new Error('not_allowed');
  return email;
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64urlEncode(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data))));
}

/** 通行証を作る（中身：メールアドレスと期限。秘密の鍵で署名） */
export async function issueSession(email, ttlSec, secret, nowSec = Math.floor(Date.now() / 1000)) {
  const exp = nowSec + ttlSec;
  const body = b64urlEncode(enc.encode(JSON.stringify({ e: email, x: exp })));
  return { token: body + '.' + (await hmac(secret, body)), exp };
}

/** 通行証を確かめ、有効ならメールアドレスを返す（許可アドレスが変わったら無効） */
export async function readSession(token, secret, allowedEmail, nowSec = Math.floor(Date.now() / 1000)) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig || !secret) return null;
  if (!sameString(sig, await hmac(secret, body))) return null;
  let data;
  try { data = decodeJson(body); } catch { return null; }
  if (typeof data.x !== 'number' || data.x < nowSec) return null;
  if (data.e !== String(allowedEmail || '').trim().toLowerCase()) return null;
  return data.e;
}
