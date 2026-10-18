#!/usr/bin/env node
// Offline public metadata sync. MP4 streams are cancelled after headers; no full video downloads.
// Docs: https://docs.fxembed.com/api/twitter/operations/2statusid/
// Run: node scripts/sync-example-media.mjs [--refresh|--retry-failed] [--concurrency=1..4]
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DAY = 86_400_000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const validDimension = n => Number.isInteger(n) && n > 0 && n <= 16384;

function allowedMp4(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'video.twimg.com' && !url.username && !url.password && !url.port && !url.hash && /\.mp4$/i.test(url.pathname);
  } catch { return false; }
}

function postId(example) {
  const url = new URL(example.postUrl);
  const match = url.pathname.match(/^\/[A-Za-z0-9_]{1,15}\/status\/(\d{2,20})\/?$/);
  if (url.protocol !== 'https:' || !['x.com', 'twitter.com', 'www.x.com', 'www.twitter.com'].includes(url.hostname) || url.username || url.password || url.port || !match || match[1] !== example.id) throw new Error('INVALID_POST_URL');
  return match[1];
}

export function selectMedia(example, payload) {
  const id = postId(example);
  const post = payload?.status ?? payload?.tweet;
  if (payload?.code !== 200) throw new Error(`UPSTREAM_${payload?.code ?? 'INVALID'}`);
  if (post?.id !== id) throw new Error('POST_ID_MISMATCH');
  const videos = Array.isArray(post.media?.videos) ? post.media.videos : [];
  if (!videos.length) throw new Error('NO_VIDEO');
  const posterId = example.poster?.match(/\/(?:amplify_video_thumb|ext_tw_video_thumb|tweet_video_thumb)\/(\d+)\//)?.[1];
  const matches = videos.filter(v => (posterId && (v.id === posterId || v.url?.includes(`/${posterId}/`))) || (v.thumbnail_url && example.poster?.endsWith(new URL(v.thumbnail_url).pathname)));
  if (matches.length > 1 || (!matches.length && videos.length > 1)) throw new Error('POSTER_VIDEO_MISMATCH');
  const selected = matches[0] ?? videos[0];
  const formats = Array.isArray(selected.formats) ? selected.formats : [];
  const candidates = formats.filter(f => f.container === 'mp4' && (f.codec === 'h264' || (!f.codec && /\/avc1\//.test(f.url))) && allowedMp4(f.url)).map(f => {
    const dimensions = new URL(f.url).pathname.match(/\/(\d{2,5})x(\d{2,5})\//);
    const width = dimensions ? Number(dimensions[1]) : (f.width ?? (f.url === selected.url ? selected.width : null));
    const height = dimensions ? Number(dimensions[2]) : (f.height ?? (f.url === selected.url ? selected.height : null));
    return { url: f.url, width, height, bitrate: Number(f.bitrate) || 0 };
  }).filter(f => validDimension(f.width) && validDimension(f.height));
  const within720 = candidates.filter(f => Math.min(f.width, f.height) <= 720);
  const ranked = within720.length ? within720.sort((a, b) => b.width * b.height - a.width * a.height || b.bitrate - a.bitrate) : candidates.sort((a, b) => Math.min(a.width, a.height) - Math.min(b.width, b.height) || a.width * a.height - b.width * b.height);
  if (!ranked.length) throw new Error('NO_COMPATIBLE_MP4');
  const chosen = ranked[0];
  return { media: { url: chosen.url, type: 'video/mp4', width: chosen.width, height: chosen.height }, selection: matches.length ? 'poster-match' : 'single-video', mediaId: selected.id ?? null, videoCount: videos.length };
}

async function request(url, method, options, json = false) {
  const { fetchImpl = fetch, sleepImpl = sleep } = options;
  let result;
  for (let attempt = 1; attempt <= 3; attempt++) {
    let retryAfter = 0;
    try {
      const response = await fetchImpl(url, { method, redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'ClaudeMotionVideo-PublicMediaSync/1.0', ...(method === 'GET' && !json ? { Range: 'bytes=0-0' } : {}), ...(json ? { Accept: 'application/json' } : {}) } });
      retryAfter = Number(response.headers.get('retry-after')) * 1000 || 0;
      result = { status: response.status, attempts: attempt, contentType: response.headers.get('content-type') ?? '' };
      if (!json) result.contentRange = response.headers.get('content-range');
      if (json && response.ok) {
        const reader = response.body?.getReader(); let size = 0; const chunks = [];
        if (!reader) throw new Error('EMPTY_RESPONSE');
        try {
          for (;;) {
            const { done, value } = await reader.read(); if (done) break;
            size += value.byteLength; if (size > 2_000_000) throw new Error('RESPONSE_TOO_LARGE');
            chunks.push(value);
          }
          result.payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (typeof result.payload.code === 'number' && result.payload.code !== 200) result.status = result.payload.code;
        } finally { await reader.cancel().catch(() => {}); }
      } else { await response.body?.cancel(); }
      if (result.status !== 429 && result.status < 500) return result;
    } catch (error) { result = { status: 0, attempts: attempt, error: error.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK_OR_INVALID_RESPONSE' }; }
    if (attempt < 3) await sleepImpl(Math.min(10000, Math.max(500 * 2 ** (attempt - 1), retryAfter)));
  }
  return result;
}

export async function requestJson(url, options = {}) { return request(url, 'GET', options, true); }

export async function checkVideo(url, options = {}) {
  if (!allowedMp4(url)) return { available: false, status: 0, error: 'INVALID_MEDIA_URL' };
  const result = await request(url, 'GET', options);
  return { ...result, validationVersion: 2, method: 'RANGE_0_0', referrerPolicy: 'no-referrer', range: 'bytes=0-0', available: [200, 206].includes(result.status) && /^video\/mp4(?:;|$)/i.test(result.contentType ?? '') };
}

async function readJson(file) { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; } }
async function atomicJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
}

export async function syncExamples({ examples, outputPath, auditPath, cacheDir, concurrency = 4, refresh = false, retryFailed = false, fetchImpl = fetch, sleepImpl = sleep, onProgress = () => {} }) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error('Concurrency must be 1..4');
  const inputs = Object.entries(examples); const entries = {}; const manifest = {};
  let cursor = 0, completed = 0, nextRequestAt = 0, writes = Promise.resolve();
  const options = { sleepImpl, fetchImpl: async (...args) => {
    const wait = Math.max(0, nextRequestAt - Date.now()); nextRequestAt = Math.max(nextRequestAt, Date.now()) + 125;
    if (wait) await sleepImpl(wait);
    return fetchImpl(...args);
  } };
  const checkpoint = () => { writes = writes.then(() => atomicJson(outputPath, Object.fromEntries(inputs.filter(([id]) => manifest[id]).map(([id]) => [id, manifest[id]])))); return writes; };
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < inputs.length) {
      const [id, example] = inputs[cursor++];
      const record = { id, postUrl: example.postUrl, available: false, cacheHit: false };
      let cache;
      try {
        if (id !== example.id) throw new Error('EXAMPLE_ID_MISMATCH');
        postId(example);
        record.apiUrl = `https://api.fxtwitter.com/2/status/${id}`;
        const cachePath = path.join(cacheDir, `${id}.json`); cache = await readJson(cachePath);
        const fresh = cache?.version === 1 && cache.apiUrl === record.apiUrl && Date.now() - Date.parse(cache.fetchedAt) < (cache.result.status === 200 ? 7 * DAY : DAY / 24);
        if (!refresh && fresh && !(retryFailed && !cache.available)) record.cacheHit = true;
        else cache = { version: 1, apiUrl: record.apiUrl, fetchedAt: new Date().toISOString(), result: await requestJson(record.apiUrl, options) };
        record.apiStatus = cache.result.status; record.attempts = cache.result.attempts; record.metadataFetchedAt = cache.fetchedAt;
        if (cache.result.status !== 200) throw new Error(`UPSTREAM_${cache.result.status || cache.result.error}`);
        const chosen = selectMedia(example, cache.result.payload);
        Object.assign(record, chosen);
        if (refresh || cache.videoCheck?.validationVersion !== 2 || cache.videoCheck?.method !== 'RANGE_0_0' || cache.videoUrl !== chosen.media.url || Date.now() - Date.parse(cache.checkedAt) >= (cache.videoCheck.available ? 7 * DAY : DAY / 24) || (retryFailed && !cache.videoCheck.available)) {
          cache.videoCheck = await checkVideo(chosen.media.url, options); cache.videoUrl = chosen.media.url; cache.checkedAt = new Date().toISOString();
        }
        record.videoCheck = cache.videoCheck; record.videoCheckedAt = cache.checkedAt;
        if (!cache.videoCheck.available) throw new Error('VIDEO_NOT_ACCESSIBLE');
        record.available = true; manifest[id] = chosen.media;
      } catch (error) { record.reason = error.message; }
      if (cache) { cache.available = record.available; await atomicJson(path.join(cacheDir, `${id}.json`), cache); }
      entries[id] = record; completed++;
      if (completed === 12 || completed % 50 === 0 || completed === inputs.length) {
        await checkpoint(); onProgress({ completed, total: inputs.length, available: Object.keys(manifest).length, unavailable: Object.values(entries).filter(e => !e.available).length });
      }
    }
  }));
  await checkpoint();
  const ordered = Object.fromEntries(inputs.map(([id]) => [id, entries[id]]));
  const audit = { checkedAt: new Date().toISOString(), source: 'https://docs.fxembed.com/api/twitter/operations/2statusid/', summary: { total: inputs.length, available: Object.keys(manifest).length, unavailable: inputs.length - Object.keys(manifest).length, cacheHits: Object.values(entries).filter(e => e.cacheHit).length }, entries: ordered };
  await atomicJson(auditPath, audit);
  return audit;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--refresh', '--retry-failed'].includes(arg) && !/^--concurrency=[1-4]$/.test(arg))) throw new Error('Usage: node scripts/sync-example-media.mjs [--refresh|--retry-failed] [--concurrency=1..4]');
  const examples = await readJson(path.join(ROOT, 'public/reference-assets/data/examples.json'));
  if (!examples || Object.keys(examples).length !== 470) throw new Error('Expected the existing 470-example catalog');
  const audit = await syncExamples({ examples, outputPath: path.join(ROOT, 'public/reference-assets/data/example-media.json'), auditPath: path.join(ROOT, 'RECON/example-media-sync.json'), cacheDir: path.join(ROOT, 'RECON/example-media-cache'), concurrency: Number(args.find(a => a.startsWith('--concurrency='))?.split('=')[1] ?? 4), refresh: args.includes('--refresh'), retryFailed: args.includes('--retry-failed'), onProgress: progress => console.log(JSON.stringify(progress)) });
  console.log(JSON.stringify(audit.summary));
  if (audit.summary.unavailable) console.log('Unavailable IDs:', Object.values(audit.entries).filter(e => !e.available).map(e => `${e.id}:${e.reason}`).join(', '));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
