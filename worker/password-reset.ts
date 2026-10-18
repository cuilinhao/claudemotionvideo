import { digest, hashPassword } from './auth';
import { ApiError } from './errors';
import type { Env } from './types';

export async function requestPasswordReset(env: Env, email: string, now = Math.floor(Date.now() / 1000)) {
  if (!env.EMAIL || !env.EMAIL_FROM) throw new ApiError(503, 'Password reset email is not available yet. Please contact support.', 'EMAIL_UNAVAILABLE');
  const accepted = { ok: true, message: 'If an account exists for this email, a password reset link will arrive shortly.' };
  const user = await env.DB.prepare('SELECT id,email FROM users WHERE email=?').bind(email).first<{ id: string; email: string }>();
  if (!user) return accepted;
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
  const tokenHash = await digest(token);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM password_resets WHERE user_id=?').bind(user.id),
    env.DB.prepare('INSERT INTO password_resets (token_hash,user_id,expires_at) VALUES (?,?,?)').bind(tokenHash, user.id, now + 1800),
  ]);
  try {
    await env.EMAIL.send({ from: env.EMAIL_FROM, to: user.email, subject: 'Reset your Claude Motion Video password',
      text: `Reset your password using this link. It expires in 30 minutes and can be used only once.\n\n${env.APP_URL}/reset-password#token=${token}\n\nIf you did not request this, you can safely ignore this email.` });
  } catch (error) {
    await env.DB.prepare('DELETE FROM password_resets WHERE token_hash=?').bind(tokenHash).run();
    // Return the same response for all addresses, including delivery failures.
    console.error('Password reset delivery failed', { type: error instanceof Error ? error.name : 'Unknown' });
  }
  return accepted;
}

export async function resetPassword(db: D1Database, token: string, password: string, now = Math.floor(Date.now() / 1000)) {
  if (!/^[a-f0-9]{64}$/.test(token) || password.length < 10 || password.length > 128) throw new ApiError(400, 'Enter a valid reset token and a password between 10 and 128 characters.');
  const tokenHash = await digest(token); const hash = await hashPassword(password);
  const results = await db.batch([
    db.prepare('UPDATE users SET password_hash=? WHERE id=(SELECT user_id FROM password_resets WHERE token_hash=? AND expires_at>? AND consumed_at IS NULL)')
      .bind(hash, tokenHash, now),
    db.prepare('DELETE FROM sessions WHERE user_id=(SELECT user_id FROM password_resets WHERE token_hash=? AND expires_at>? AND consumed_at IS NULL)')
      .bind(tokenHash, now),
    db.prepare('UPDATE password_resets SET consumed_at=? WHERE user_id=(SELECT user_id FROM password_resets WHERE token_hash=? AND expires_at>? AND consumed_at IS NULL) AND consumed_at IS NULL')
      .bind(now, tokenHash, now),
  ]);
  if (!results[0].meta.changes) throw new ApiError(400, 'This password reset link has expired or has already been used.', 'RESET_EXPIRED');
  return { ok: true };
}
