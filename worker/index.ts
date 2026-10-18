import { app } from './app';
import { refillAnnualSubscribers } from './billing';
import { recoverStaleJobs } from './workflow-runner';
import { recoverStaleSpeech } from './audio';
import type { Env } from './types';
export { GenerationWorkflow } from './workflow';

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext) {
    const url = new URL(request.url);
    if (url.hostname === 'www.claudemotionvideo.com') {
      url.hostname = 'claudemotionvideo.com'; url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname.startsWith('/api/')) return app.fetch(request, env, context);
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.set('X-Frame-Options', 'DENY');
    headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
  async scheduled(_controller: ScheduledController, env: Env, context: ExecutionContext) {
    context.waitUntil(Promise.all([
      refillAnnualSubscribers(env), recoverStaleJobs(env), recoverStaleSpeech(env),
      env.DB.batch([
        env.DB.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(Math.floor(Date.now() / 1000)),
        env.DB.prepare('DELETE FROM rate_limits WHERE expires_at<=?').bind(Math.floor(Date.now() / 1000)),
        env.DB.prepare('DELETE FROM password_resets WHERE expires_at<=? OR consumed_at IS NOT NULL').bind(Math.floor(Date.now() / 1000)),
      ]),
    ]));
  },
} satisfies ExportedHandler<Env>;
