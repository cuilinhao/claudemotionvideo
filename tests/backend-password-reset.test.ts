import { describe, expect, it } from 'vitest';
import { requestPasswordReset, resetPassword } from '../worker/password-reset';
import { createSession, hashPassword, verifyPassword } from '../worker/auth';
import { makeDb, seedUser } from './backend-db';
import type { Env } from '../worker/types';

describe('password reset tokens', () => {
  it('sends a single-use expiring link, changes the password and invalidates sessions', async () => {
    const { db } = makeDb(); await seedUser(db);
    await db.prepare('UPDATE users SET password_hash=? WHERE id=?').bind(await hashPassword('old password value'), 'alice').run();
    await createSession(db, 'alice');
    const messages: { text?: string }[] = [];
    const env = { DB: db, APP_URL: 'https://claudemotionvideo.com', EMAIL_FROM: 'support@claudemotionvideo.com', EMAIL: { send: async (message: { text?: string }) => { messages.push(message); return { messageId: 'm' }; } } } as unknown as Env;
    await requestPasswordReset(env, 'alice@example.com', 100);
    const token = messages[0].text!.match(/#token=([a-f0-9]+)/)![1];
    const stored = await db.prepare('SELECT token_hash FROM password_resets').first('token_hash');
    expect(stored).not.toBe(token);
    await resetPassword(db, token, 'new sufficiently long password', 101);
    const hash = await db.prepare("SELECT password_hash FROM users WHERE id='alice'").first<string>('password_hash');
    expect(await verifyPassword('new sufficiently long password', hash!)).toBe(true);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM sessions').first('n')).toBe(0);
    await expect(resetPassword(db, token, 'another sufficiently long password', 102)).rejects.toThrow(/expired|used/i);
  });
  it('gives the same accepted result for unknown accounts and rejects expired tokens', async () => {
    const { db } = makeDb(); await seedUser(db);
    let token = '';
    const env = { DB: db, APP_URL: 'https://claudemotionvideo.com', EMAIL_FROM: 'support@claudemotionvideo.com', EMAIL: { send: async (message: { text: string }) => { token = message.text.match(/#token=([a-f0-9]+)/)![1]; return { messageId: 'm' }; } } } as unknown as Env;
    const known = await requestPasswordReset(env, 'alice@example.com', 100);
    const unknown = await requestPasswordReset(env, 'unknown@example.com', 100);
    expect(unknown).toEqual(known);
    await expect(resetPassword(db, token, 'a sufficiently long password', 1901)).rejects.toThrow(/expired|used/i);
  });
  it('clearly reports unavailable email delivery regardless of account existence', async () => {
    const { db } = makeDb(); await seedUser(db);
    const env = { DB: db } as Env;
    await expect(requestPasswordReset(env, 'alice@example.com')).rejects.toMatchObject({ status: 503 });
    await expect(requestPasswordReset(env, 'unknown@example.com')).rejects.toMatchObject({ status: 503 });
  });
});
