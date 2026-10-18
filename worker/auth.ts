import type { UserRow } from './types';

const ITERATIONS = 100_000; // Workers WebCrypto supported per-operation maximum.
export const SESSION_COOKIE = 'cmv_session';
export const SESSION_AGE = 30 * 86400;
const encoder = new TextEncoder();
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
function unhex(value: string) { return Uint8Array.from(value.match(/.{2}/g) ?? [], byte => parseInt(byte, 16)); }
export async function digest(value: string) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))); }

async function derive(password: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, key, 256)));
}
export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2_sha256$${ITERATIONS}$${hex(salt)}$${await derive(password, salt)}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [algorithm, iterations, salt, expected] = stored.split('$');
  if (algorithm !== 'pbkdf2_sha256' || Number(iterations) !== ITERATIONS || !/^[a-f0-9]{32}$/.test(salt ?? '') || !/^[a-f0-9]{64}$/.test(expected ?? '')) return false;
  const actual = await derive(password, unhex(salt));
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  return difference === 0;
}
export function allowedOrigin(origin: string | null, appUrl: string) {
  if (!origin) return false;
  try { return origin === new URL(appUrl).origin; } catch { return false; }
}
export async function rateLimit(db: D1Database, key: string, maximum: number, seconds: number, now = Math.floor(Date.now() / 1000)) {
  const row = await db.prepare(`INSERT INTO rate_limits (key,count,expires_at) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,
    expires_at=CASE WHEN expires_at<=? THEN ? ELSE expires_at END RETURNING count`)
    .bind(key, now + seconds, now, now, now + seconds).first<{ count: number }>();
  return !!row && row.count <= maximum;
}
export async function createSession(db: D1Database, userId: string, now = Math.floor(Date.now() / 1000)) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  await db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)')
    .bind(await digest(token), userId, now + SESSION_AGE, now).run();
  return token;
}
export async function getSessionUser(db: D1Database, token: string | undefined, now = Math.floor(Date.now() / 1000)) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return db.prepare('SELECT users.* FROM users JOIN sessions ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>?')
    .bind(await digest(token), now).first<UserRow>();
}
