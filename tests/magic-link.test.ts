import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../worker/app';
import { createSession, digest, getSessionUser, hashPassword, verifyPassword } from '../worker/auth';
import type { Env } from '../worker/types';
import { makeDb, seedUser } from './backend-db';

const origin = 'https://claudemotionvideo.com';
describe('email magic-link sign in', () => {
  let env: Env;
  let messages: EmailMessageBuilder[];
  const request = (path: string, body?: unknown, headers: Record<string, string> = {}) => app.request(origin + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  const send = (email = 'new@example.com', callbackURL = '/studio') => request('/api/auth/sign-in/magic-link', { email, callbackURL });
  const token = () => {
    expect(messages.at(-1)?.text ?? '').toMatch(/#token=[a-f0-9]{64}/);
    return messages.at(-1)!.text!.match(/#token=([a-f0-9]{64})/)![1];
  };
  const consume = (value = token()) => request('/api/auth/magic-link/consume', { token: value });
  beforeEach(() => {
    const { db } = makeDb(); messages = [];
    env = { DB: db, APP_URL: origin, EMAIL_FROM: 'noreply@claudemotionvideo.com',
      EMAIL: { send: async (message: EmailMessageBuilder) => { messages.push(message); return { messageId: 'mail-id' }; } },
    } as unknown as Env;
  });
  afterEach(() => vi.useRealTimers());

  it('creates no account until a hashed email token is consumed and issues a secure session', async () => {
    const sent = await send(' NEW@Example.com ', '/studio?scene=launch');
    expect(sent.status).toBe(200);
    expect(await sent.json()).toMatchObject({ ok: true });
    expect(messages[0]).toMatchObject({ to: 'new@example.com', from: 'noreply@claudemotionvideo.com' });
    expect(messages[0].text).toContain(`${origin}/sign-in#token=`);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first('n')).toBe(0);
    expect(await env.DB.prepare('SELECT token_hash FROM magic_links').first('token_hash')).toBe(await digest(token()));
    const signedIn = await consume();
    expect(signedIn.status).toBe(200);
    expect(await signedIn.json()).toMatchObject({ user: { email: 'new@example.com', credits: 0, plan: 'free' }, redirect: '/studio?scene=launch' });
    const cookie = signedIn.headers.get('set-cookie')!;
    expect(cookie).toMatch(/HttpOnly/); expect(cookie).toMatch(/Secure/); expect(cookie).toMatch(/SameSite=Lax/i);
    const me = await request('/api/me', undefined, { Cookie: cookie.split(';')[0] });
    expect((await me.json()).user.email).toBe('new@example.com');
  });
  it('reuses an existing paid account without changing its password, credits, or plan', async () => {
    await seedUser(env.DB, 'alice', 350);
    const password = await hashPassword('existing correct password');
    await env.DB.prepare("UPDATE users SET password_hash=?,plan='pro',email_verified_at=1 WHERE id='alice'").bind(password).run();
    await send('alice@example.com');
    const result = await consume();
    expect(result.status).toBe(200);
    expect((await result.json()).user).toMatchObject({ id: 'alice', credits: 350, plan: 'pro' });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first('n')).toBe(1);
    expect(await verifyPassword('existing correct password', (await env.DB.prepare("SELECT password_hash FROM users WHERE id='alice'").first<string>('password_hash'))!)).toBe(true);
  });
  it('removes a pre-registered account password and sessions when its real email owner first signs in', async () => {
    await seedUser(env.DB, 'victim', 350);
    const knownPassword = await hashPassword('attacker chosen password');
    await env.DB.prepare("UPDATE users SET password_hash=?,plan='pro' WHERE id='victim'").bind(knownPassword).run();
    const attackerSession = await createSession(env.DB, 'victim');
    await send('victim@example.com');
    const result = await consume();
    expect(result.status).toBe(200);
    expect((await result.json()).user).toMatchObject({ id: 'victim', credits: 350, plan: 'pro' });
    expect(await getSessionUser(env.DB, attackerSession)).toBeNull();
    const hash = await env.DB.prepare("SELECT password_hash FROM users WHERE id='victim'").first<string>('password_hash');
    expect(await verifyPassword('attacker chosen password', hash!)).toBe(false);
    expect(await env.DB.prepare("SELECT email_verified_at FROM users WHERE id='victim'").first('email_verified_at')).toEqual(expect.any(Number));
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first('n')).toBe(1);
  });
  it('allows exactly one session when two consumers race and rejects subsequent replay', async () => {
    await send(); const value = token();
    const responses = await Promise.all([consume(value), consume(value)]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 400]);
    expect((await consume(value)).status).toBe(400);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first('n')).toBe(1);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first('n')).toBe(1);
  });
  it('rejects an expired link at ten minutes without creating a user or session', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-18T00:00:00Z'));
    await send(); vi.setSystemTime(new Date('2026-10-18T00:10:00Z'));
    expect((await consume()).status).toBe(400);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first('n')).toBe(0);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first('n')).toBe(0);
  });
  it('rejects external, protocol-relative, encoded, and backslash callback redirects', async () => {
    for (const callbackURL of ['https://evil.test', '//evil.test', '/\\evil.test', '/%2f%2fevil.test', '/%5cevil.test', '/\r\nevil']) {
      expect((await send('new@example.com', callbackURL)).status).toBe(400);
    }
    expect(messages).toHaveLength(0);
  });
  it('rejects cross-origin requests and invalid tokens without emailing or setting a session', async () => {
    expect((await request('/api/auth/sign-in/magic-link', { email: 'new@example.com' }, { Origin: 'https://evil.test' })).status).toBe(403);
    expect((await consume('not-a-token')).status).toBe(400);
    expect((await consume('a'.repeat(64))).status).toBe(400);
    expect(messages).toHaveLength(0);
  });
  it('limits requests per email even when an attacker rotates IP addresses', async () => {
    for (let index = 0; index < 3; index++) {
      const response = await request('/api/auth/sign-in/magic-link', { email: 'new@example.com' }, { 'CF-Connecting-IP': `192.0.2.${index}` });
      expect(response.status).toBe(200);
    }
    expect((await request('/api/auth/sign-in/magic-link', { email: 'NEW@example.com' }, { 'CF-Connecting-IP': '192.0.2.50' })).status).toBe(429);
    expect(messages).toHaveLength(3);
  });
  it('reports missing email delivery capability and advertises actual available providers', async () => {
    expect((await (await request('/api/me')).json()).providers).toEqual({ email: true, google: false });
    env.EMAIL = undefined;
    expect((await send()).status).toBe(503);
    expect((await (await request('/api/me')).json()).providers).toEqual({ email: false, google: false });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first('n')).toBe(0);
  });
  it('invalidates a token after email delivery fails and returns a clear error', async () => {
    env.EMAIL = { send: async (message: EmailMessageBuilder) => { messages.push(message); throw new Error('provider offline'); } } as Env['EMAIL'];
    expect((await send()).status).toBe(503);
    expect((await consume()).status).toBe(400);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM magic_links').first('n')).toBe(0);
  });
});
