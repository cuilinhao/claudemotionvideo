import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { selectMedia, requestJson, checkVideo, syncExamples } from '../scripts/sync-example-media.mjs';

const videoUrl = (id, dimensions, filename = 'clip', codec = 'avc1') => `https://video.twimg.com/amplify_video/${id}/vid/${codec}/${dimensions}/${filename}.mp4?tag=29`;
const example = { id: '2103315922098470926', postUrl: 'https://x.com/stephanlivera/status/2103315922098470926', poster: '/reference-assets/external/pbs.twimg.com/amplify_video_thumb/2103315748496302080/img/poster.jpg' };
const video = (id = '2103315748496302080') => ({ id, type: 'video', format: 'video/mp4', width: 1920, height: 1080, url: videoUrl(id, '1920x1080'), thumbnail_url: `https://pbs.twimg.com/amplify_video_thumb/${id}/img/poster.jpg`, formats: [
  { container: 'mp4', codec: 'h264', bitrate: 256000, url: videoUrl(id, '480x270') },
  { container: 'mp4', codec: 'h264', bitrate: 2176000, url: videoUrl(id, '1280x720') },
  { container: 'mp4', codec: 'h264', bitrate: 10368000, url: videoUrl(id, '1920x1080') },
] });
const payload = (videos = [video()]) => ({ code: 200, status: { id: example.id, media: { videos } } });
const dirs = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

describe('example MP4 selection', () => {
  it('selects the highest H.264 rendition up to 720p with rendition dimensions', () => {
    expect(selectMedia(example, payload()).media).toEqual({ url: videoUrl('2103315748496302080', '1280x720'), type: 'video/mp4', width: 1280, height: 720 });
  });
  it('matches the poster media id rather than the first video in a multi-video post', () => {
    expect(selectMedia(example, payload([video('2103315748496302001'), video()])).media.url).toContain('/2103315748496302080/');
  });
  it('does not guess a different video for an ambiguous unmatched poster', () => {
    expect(() => selectMedia(example, payload([video('2103315748496302001'), video('2103315748496302002')]))).toThrow('POSTER_VIDEO_MISMATCH');
  });
  it('supports portrait 720p and excludes an advertised HEVC MP4 even with higher resolution', () => {
    const v = video(); v.formats = [ { container: 'mp4', codec: 'h264', url: videoUrl(v.id, '720x1280') }, { container: 'mp4', codec: 'hevc', url: videoUrl(v.id, '1080x1920', 'clip', 'hvc1') } ];
    expect(selectMedia(example, payload([v])).media).toEqual({ url: videoUrl(v.id, '720x1280'), type: 'video/mp4', width: 720, height: 1280 });
  });
  it.each(['http://video.twimg.com/a.mp4', 'https://user:password@video.twimg.com/a.mp4', 'https://video.twimg.com.evil.example/a.mp4', 'https://video.twimg.com:444/a.mp4', 'https://video.twimg.com/a.m3u8'])('rejects unsafe playback URL %s', (url) => {
    const v = video(); v.url = url; v.formats = [{ container: 'mp4', codec: 'h264', width: 720, height: 720, url }];
    expect(() => selectMedia(example, payload([v]))).toThrow('NO_COMPATIBLE_MP4');
  });
  it('does not attach metadata for a different post', () => {
    const p = payload(); p.status.id = '2100000000000000000';
    expect(() => selectMedia(example, p)).toThrow('POST_ID_MISMATCH');
  });
});

describe('bounded upstream requests', () => {
  it('retries temporary failures and honours the bounded retry delay', async () => {
    let attempts = 0; const delays = [];
    const result = await requestJson('https://api.fxtwitter.com/2/status/123', { fetchImpl: async () => ++attempts === 1 ? new Response('', { status: 429, headers: { 'retry-after': '100' } }) : Response.json(payload()), sleepImpl: async ms => { delays.push(ms); } });
    expect(result.status).toBe(200); expect(result.attempts).toBe(2); expect(delays).toEqual([10000]);
  });
  it('stops after three server failures and does not retry a missing post', async () => {
    const server = await requestJson('https://api.fxtwitter.com/2/status/123', { fetchImpl: async () => new Response('', { status: 503 }), sleepImpl: async () => {} });
    expect(server.attempts).toBe(3); expect(server.status).toBe(503);
    const missing = await requestJson('https://api.fxtwitter.com/2/status/123', { fetchImpl: async () => new Response('', { status: 404 }), sleepImpl: async () => {} });
    expect(missing.attempts).toBe(1); expect(missing.status).toBe(404);
  });
  it('checks GET Range without Referer, requires video MIME, and cancels instead of consuming the MP4 body', async () => {
    let cancelled = false;
    const good = await checkVideo(videoUrl('123', '1280x720'), { fetchImpl: async (_url, options) => {
      expect(options.method).toBe('GET'); expect(options.headers.Range).toBe('bytes=0-0'); expect(options.referrerPolicy).toBe('no-referrer');
      return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 206, headers: { 'content-type': 'video/mp4' } });
    } });
    expect(good.available).toBe(true);
    expect(good.method).toBe('RANGE_0_0'); expect(cancelled).toBe(true);
    const bad = await checkVideo(videoUrl('123', '1280x720'), { fetchImpl: async () => new Response(null, { status: 200, headers: { 'content-type': 'text/html' } }) });
    expect(bad.available).toBe(false);
  });
});

it('writes only verified URLs, records 404, limits concurrency, and reuses fresh cache', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cmv-example-sync-')); dirs.push(dir);
  const examples = Object.fromEntries(Array.from({ length: 6 }, (_, i) => { const id = String(2103315922098470926n + BigInt(i)); return [id, { ...example, id, postUrl: `https://x.com/author/status/${id}` }]; }));
  let active = 0, maximum = 0;
  const fetchImpl = async (url, options) => {
    active++; maximum = Math.max(active, maximum); await new Promise(resolve => setTimeout(resolve, 2)); active--;
    if (url.startsWith('https://video.twimg.com/')) return new Response(null, { headers: { 'content-type': 'video/mp4' } });
    const id = url.split('/').at(-1); if (id === '2103315922098470931') return new Response('', { status: 404 });
    const p = payload(); p.status.id = id; return Response.json(p);
  };
  const options = { examples, outputPath: path.join(dir, 'media.json'), auditPath: path.join(dir, 'audit.json'), cacheDir: path.join(dir, 'cache'), fetchImpl, sleepImpl: async () => {} };
  const first = await syncExamples(options);
  const manifest = JSON.parse(await readFile(options.outputPath, 'utf8'));
  expect(Object.keys(manifest)).toHaveLength(5); expect(manifest['2103315922098470931']).toBeUndefined(); expect(first.summary.unavailable).toBe(1); expect(maximum).toBeLessThanOrEqual(4);
  const second = await syncExamples({ ...options, fetchImpl: async () => { throw new Error('cache was not reused'); } });
  expect(second.summary.available).toBe(5); expect(second.summary.cacheHits).toBe(6);
  // A previous HEAD success must not suppress the newer GET check; metadata stays cached.
  const cachePath = path.join(options.cacheDir, '2103315922098470926.json');
  const oldCache = JSON.parse(await readFile(cachePath, 'utf8')); oldCache.videoCheck.method = 'HEAD';
  await writeFile(cachePath, JSON.stringify(oldCache));
  let rangeChecks = 0;
  const upgraded = await syncExamples({ ...options, fetchImpl: async (url, request) => {
    if (!url.startsWith('https://video.twimg.com/')) throw new Error('Metadata should remain cached');
    expect(request.method).toBe('GET'); rangeChecks++;
    return new Response(null, { status: 206, headers: { 'content-type': 'video/mp4' } });
  } });
  expect(upgraded.summary.available).toBe(5); expect(rangeChecks).toBe(1);
});
