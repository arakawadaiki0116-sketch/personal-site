// auth.js の確認（node test/auth.test.js）
// 自分で作った鍵で「Google の ID トークンもどき」を署名し、確認の仕組みが正しく通す・弾くかを見る。
import assert from 'node:assert/strict';
import { verifyGoogleIdToken, issueSession, readSession, b64urlEncode } from '../src/auth.js';

const enc = new TextEncoder();
const kp = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify']
);
const pub = await crypto.subtle.exportKey('jwk', kp.publicKey);
const jwks = { keys: [{ ...pub, kid: 'k1', alg: 'RS256', use: 'sig' }] };

async function makeToken(payload, kid = 'k1', key = kp.privateKey) {
  const h = b64urlEncode(enc.encode(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })));
  const p = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(h + '.' + p)));
  return h + '.' + p + '.' + b64urlEncode(sig);
}

const now = 1_800_000_000;
const base = {
  iss: 'https://accounts.google.com', aud: 'client-123', exp: now + 3600, iat: now,
  nonce: 'n-1', email: 'Owner@Example.com', email_verified: true
};
const opt = { clientId: 'client-123', allowedEmail: 'owner@example.com', nonce: 'n-1', jwks, nowSec: now };

// 正しいトークン → メールアドレスが返る（大文字小文字は区別しない）
assert.equal(await verifyGoogleIdToken(await makeToken(base), opt), 'owner@example.com');

async function rejects(payload, reason, o = opt, kid) {
  await assert.rejects(verifyGoogleIdToken(await makeToken(payload, kid), o), (e) => e.message === reason);
}
await rejects({ ...base, email: 'someone@example.com' }, 'not_allowed');   // 別の人
await rejects({ ...base, aud: 'other-client' }, 'aud');                    // 別のアプリ向け
await rejects({ ...base, iss: 'https://evil.example' }, 'iss');
await rejects({ ...base, exp: now - 3600 }, 'expired');
await rejects({ ...base, nonce: 'n-2' }, 'nonce');                         // 使い回し
await rejects({ ...base, email_verified: false }, 'unverified');
await rejects(base, 'kid', opt, 'unknown');

// 別の鍵で署名したもの → 弾く
const other = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify']
);
await assert.rejects(verifyGoogleIdToken(await makeToken(base, 'k1', other.privateKey), opt), (e) => e.message === 'signature');

// 通行証
const s = await issueSession('owner@example.com', 100, 'secret-A', now);
assert.equal(await readSession(s.token, 'secret-A', 'owner@example.com', now + 50), 'owner@example.com');
assert.equal(await readSession(s.token, 'secret-A', 'owner@example.com', now + 101), null); // 期限切れ
assert.equal(await readSession(s.token, 'secret-B', 'owner@example.com', now), null);       // 鍵を変えたら無効
assert.equal(await readSession(s.token, 'secret-A', 'other@example.com', now), null);       // 許可アドレスを変えたら無効
assert.equal(await readSession(s.token.slice(0, -2) + 'xx', 'secret-A', 'owner@example.com', now), null); // 改ざん

console.log('ok');
