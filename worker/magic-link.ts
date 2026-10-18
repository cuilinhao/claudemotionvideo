import { z } from 'zod';
import { digest, emailVerificationStatements, hashPassword, SESSION_AGE } from './auth';
import { ApiError } from './errors';
import type { Env, UserRow } from './types';

const emailSchema = z.string().trim().toLowerCase().email().max(254);
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');

/** Only return normalized paths that remain on this site when assigned to location. */
export function safeLocalPath(value: string) {
  if (!value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(value)) return false;
  try {
    const parsed = new URL(value, 'https://local.invalid');
    let path = parsed.pathname;
    for (let i = 0; i < 3; i++) {
      path = decodeURIComponent(path);
      if (path.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(path)) return false;
    }
    return parsed.origin === 'https://local.invalid' && !parsed.pathname.startsWith('//');
  } catch { return false; }
}

export const magicLinkInput = z.object({
  email: emailSchema,
  callbackURL: z.string().max(2048).refine(safeLocalPath).default('/studio'),
}).strict();

export async function requestMagicLink(env: Env, input: z.infer<typeof magicLinkInput>, now = Math.floor(Date.now() / 1000)) {
  if (!env.EMAIL || !env.EMAIL_FROM) throw new ApiError(503, 'Email sign-in is temporarily unavailable. Please try again later.', 'EMAIL_UNAVAILABLE');
  const token = randomToken(); const tokenHash = await digest(token);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM magic_links WHERE expires_at<=?').bind(now),
    env.DB.prepare('INSERT INTO magic_links (token_hash,email,callback_path,expires_at,created_at) VALUES (?,?,?,?,?)')
      .bind(tokenHash, input.email, input.callbackURL, now + 600, now),
  ]);
  try {
    await env.EMAIL.send({ from: env.EMAIL_FROM, to: input.email, subject: 'Sign in to Claude Motion Video',
      text: `Sign in to Claude Motion Video using the link below. It expires in 10 minutes and can be used only once.\n\n${new URL('/sign-in', env.APP_URL).href}#token=${token}\n\nIf you did not request this link, you can safely ignore this email.` });
  } catch {
    await env.DB.prepare('DELETE FROM magic_links WHERE token_hash=?').bind(tokenHash).run();
    throw new ApiError(503, 'We could not send your sign-in link. Please try again later.', 'EMAIL_DELIVERY_FAILED');
  }
  return { ok: true, message: 'Check your email for a sign-in link.' };
}

export async function consumeMagicLink(env: Env, token: string, now = Math.floor(Date.now() / 1000)) {
  const expired = () => new ApiError(400, 'This sign-in link has expired or has already been used. Request a new link.', 'MAGIC_LINK_EXPIRED');
  if (!/^[a-f0-9]{64}$/.test(token)) throw expired();
  const tokenHash = await digest(token);
  const link = await env.DB.prepare('SELECT email,callback_path FROM magic_links WHERE token_hash=? AND expires_at>? AND consumed_at IS NULL')
    .bind(tokenHash, now).first<{ email: string; callback_path: string }>();
  if (!link) throw expired();
  const session = randomToken(); const sessionHash = await digest(session);
  // First verification retires any credentials from an unverified registration;
  // subsequent verified sign-ins preserve the owner's existing password.
  const password = await hashPassword(randomToken());
  const verification = await emailVerificationStatements(env.DB, link.email, now, tokenHash);
  const results = await env.DB.batch([
    env.DB.prepare(`INSERT INTO users (id,email,password_hash,created_at)
      SELECT ?,email,?,? FROM magic_links WHERE token_hash=? AND expires_at>? AND consumed_at IS NULL
      ON CONFLICT(email) DO NOTHING`)
      .bind(crypto.randomUUID(), password, new Date(now * 1000).toISOString(), tokenHash, now),
    ...verification,
    env.DB.prepare(`INSERT INTO sessions (token_hash,user_id,expires_at,created_at)
      SELECT ?,users.id,?,? FROM users JOIN magic_links ON users.email=magic_links.email
      WHERE magic_links.token_hash=? AND magic_links.expires_at>? AND magic_links.consumed_at IS NULL`)
      .bind(sessionHash, now + SESSION_AGE, now, tokenHash, now),
    env.DB.prepare('UPDATE magic_links SET consumed_at=? WHERE token_hash=? AND expires_at>? AND consumed_at IS NULL')
      .bind(now, tokenHash, now),
  ]);
  if (!results[1 + verification.length].meta.changes) throw expired();
  const user = await env.DB.prepare('SELECT users.* FROM users JOIN sessions ON users.id=sessions.user_id WHERE sessions.token_hash=?')
    .bind(sessionHash).first<UserRow>();
  if (!user) throw new Error('Verified sign-in session is missing');
  return { user, session, redirect: safeLocalPath(link.callback_path) ? link.callback_path : '/studio' };
}
