import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../worker/app';
import type { Env } from '../worker/types';
import { makeDb } from './backend-db';

const origin = 'https://cmotionvideo.com';
describe('public support delivery', () => {
  let env: Env; let messages: EmailMessageBuilder[];
  const request = (body: unknown = { email: 'visitor@example.com', body: 'I need help with my video.', page: '/studio' }, headers: Record<string, string> = {}) => app.request(origin + '/api/support', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  }, env);
  beforeEach(() => {
    const { db } = makeDb(); messages = [];
    env = { DB: db, APP_URL: origin, EMAIL_FROM: 'noreply@cmotionvideo.com', EMAIL: { send: async (message: EmailMessageBuilder) => { messages.push(message); return { messageId: 'support-message-id' }; } } } as unknown as Env;
  });
  it('delivers an anonymous request as plain text to the site support mailbox and records delivery', async () => {
    const response = await request({ email: ' Visitor@Example.com ', body: '<img src=x onerror=alert(1)> Please help.', page: '/studio' });
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ ok: true });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ to: 'cuilinhao2015@gmail.com', from: 'noreply@cmotionvideo.com', replyTo: 'visitor@example.com' });
    expect(messages[0].html).toBeUndefined();
    expect(messages[0].text).toContain('<img src=x onerror=alert(1)> Please help.');
    expect(messages[0].text).toContain('/studio');
    expect(await env.DB.prepare('SELECT email,status,provider_message_id FROM support_messages').first()).toMatchObject({ email: 'visitor@example.com', status: 'sent', provider_message_id: 'support-message-id' });
  });
  it('waits for delivery confirmation before returning success', async () => {
    let release!: () => void; let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    env.EMAIL = { send: async () => { started(); await new Promise<void>(resolve => { release = resolve; }); return { messageId: 'confirmed' }; } } as Env['EMAIL'];
    let settled = false;
    const result = request().then(response => { settled = true; return response; });
    expect(await Promise.race([entered.then(() => true), result.then(() => false)])).toBe(true);
    expect(settled).toBe(false);
    expect(await env.DB.prepare('SELECT status FROM support_messages').first('status')).toBe('pending');
    release(); expect((await result).status).toBe(200);
    expect(await env.DB.prepare('SELECT status FROM support_messages').first('status')).toBe('sent');
  });
  it('retains a failed request for tracing and reports delivery failure', async () => {
    env.EMAIL = { send: async () => { throw new Error('upstream error containing sensitive context'); } } as Env['EMAIL'];
    const result = await request();
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain('sensitive context');
    expect(await env.DB.prepare('SELECT status FROM support_messages').first('status')).toBe('failed');
  });
  it('rejects invalid emails, blank/oversized messages, and unsafe page URLs before sending', async () => {
    for (const body of [
      { email: 'bad', body: 'Help', page: '/' },
      { email: 'visitor@example.com\r\nBcc: attacker@example.com', body: 'Help', page: '/' },
      { email: 'visitor@example.com', body: '  ', page: '/' },
      { email: 'visitor@example.com', body: 'x'.repeat(2001), page: '/' },
      { email: 'visitor@example.com', body: 'Help', page: 'https://evil.test' },
    ]) expect((await request(body)).status).toBe(400);
    expect(messages).toHaveLength(0);
  });
  it('preserves CSRF protection despite allowing anonymous submissions', async () => {
    expect((await request(undefined, { Origin: 'https://evil.test' })).status).toBe(403);
    expect(messages).toHaveLength(0);
  });
  it('limits repeated anonymous submissions from one IP even if the sender changes', async () => {
    for (let i = 0; i < 5; i++) expect((await request({ email: `visitor${i}@example.com`, body: 'Help', page: '/' })).status).toBe(200);
    expect((await request({ email: 'another@example.com', body: 'Help', page: '/' })).status).toBe(429);
    expect(messages).toHaveLength(5);
  });
  it('fails explicitly without an email binding instead of claiming a message was delivered', async () => {
    env.EMAIL = undefined;
    expect((await request()).status).toBe(503);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM support_messages').first('n')).toBe(0);
  });
});
