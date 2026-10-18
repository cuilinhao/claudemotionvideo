import { z } from 'zod';
import { ApiError } from './errors';
import { safeLocalPath } from './magic-link';
import type { Env } from './types';

export const supportInput = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  body: z.string().trim().min(1).max(2000),
  page: z.string().max(2048).refine(safeLocalPath).default('/'),
}).strict();

export async function submitSupport(env: Env, input: z.infer<typeof supportInput>, userId: string | null) {
  if (!env.EMAIL || !env.EMAIL_FROM) throw new ApiError(503, 'Support messaging is temporarily unavailable. Please email cuilinhao2015@gmail.com.', 'EMAIL_UNAVAILABLE');
  const id = crypto.randomUUID(); const now = new Date().toISOString();
  await env.DB.prepare('INSERT INTO support_messages (id,user_id,email,body,page,status,created_at) VALUES (?,?,?,?,?,?,?)')
    .bind(id, userId, input.email, input.body, input.page, 'pending', now).run();
  let delivered: EmailSendResult;
  try {
    // User text is never interpolated into HTML or raw MIME headers.
    delivered = await env.EMAIL.send({ from: env.EMAIL_FROM, to: 'cuilinhao2015@gmail.com', replyTo: input.email,
      subject: `Claude Motion Video support request ${id}`,
      text: `Request: ${id}\nFrom: ${input.email}\nPage: ${input.page}\nReceived: ${now}\n\n${input.body}` });
  } catch {
    await env.DB.prepare("UPDATE support_messages SET status='failed' WHERE id=?").bind(id).run();
    throw new ApiError(503, 'Your message could not be delivered. Please try again or email cuilinhao2015@gmail.com.', 'EMAIL_DELIVERY_FAILED');
  }
  await env.DB.prepare("UPDATE support_messages SET status='sent',sent_at=?,provider_message_id=? WHERE id=?")
    .bind(new Date().toISOString(), delivered.messageId, id).run();
  return { ok: true, id };
}
