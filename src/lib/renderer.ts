/** Opaque iframe origin means event.origin is "null"; validate source AND channel. */
export function isPreviewMessage(event: MessageEvent, source: Window | null, channel: string): boolean {
  return source !== null && event.source === source && !!event.data && typeof event.data === 'object'
    && event.data.channel === channel && typeof event.data.type === 'string' && event.data.type.startsWith('cmv:');
}

export function videoDimensions(aspect: string): { width: number; height: number } {
  if (aspect === '16:9') return { width: 1920, height: 1080 };
  if (aspect === '9:16') return { width: 1080, height: 1920 };
  if (aspect === '1:1') return { width: 1080, height: 1080 };
  throw new Error('Unsupported video aspect ratio.');
}

const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; manifest-src 'none'; form-action 'none'; base-uri 'none'";

function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * Mount ONLY as iframe.srcDoc with sandbox="allow-scripts" (never allow-same-origin).
 * A fresh random channel is required for each mounted version. This document has no
 * access to the application's origin, cookies, storage or network resources.
 */
export function buildPreviewDocument(html: string, assets: Record<string, string>, channel: string): string {
  if (!/^[\w-]{8,128}$/.test(channel)) throw new Error('Invalid preview channel.');
  if (typeof html !== 'string' || html.length > 180_000 || !/<canvas\b[^>]*\bid\s*=\s*["']stage["']/i.test(html)) {
    throw new Error('This version does not contain a valid animation canvas.');
  }
  if (/<(?:iframe|object|embed|base|form|link)\b/i.test(html) || /<script\b[^>]*\bsrc\s*=/i.test(html)
    || /<meta\b[^>]*http-equiv\s*=/i.test(html)
    || /\b(?:src|href|action)\s*=\s*["']\s*(?:https?:|\/\/|javascript:)/i.test(html)) {
    throw new Error('This animation contains unsupported external resources.');
  }
  const safeAssets: Record<string, string> = Object.create(null);
  if (Object.keys(assets).length > 4) throw new Error('Too many preview assets.');
  for (const [id, url] of Object.entries(assets)) {
    if (!/^[\w-]{1,128}$/.test(id) || typeof url !== 'string' || url.length > 11_200_000
      || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(url)) {
      throw new Error('Invalid preview asset. Upload a PNG, JPEG or WebP image.');
    }
    safeAssets[id] = url;
  }
  // Keep the host's CSP first. Strip document wrappers and benign model metadata;
  // executable content remains inside the restrictive iframe and CSP boundary.
  const fragment = html.replace(/<!doctype[^>]*>/gi, '').replace(/<\/?(?:html|head|body)\b[^>]*>/gi, '')
    .replace(/<meta\b[^>]*>/gi, '').replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '');
  const bootstrap = `Object.defineProperty(window,"ASSETS",{value:Object.freeze(${scriptJson(safeAssets)}),writable:false,configurable:false});`;
  const bridge = `(function(){
  "use strict";
  const channel=${scriptJson(channel)};
  const host=window.parent;
  const send=(message,transfer=[])=>host.postMessage(Object.assign({channel},message),"*",transfer);
  const fail=()=>send({type:"cmv:error",error:"This animation could not render. Try regenerating this version."});
  let exporting=null;
  let queue=Promise.resolve();
  let stage;
  const bounded=(promise,ms)=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error("Render timeout")),ms);
    Promise.resolve(promise).then(value=>{clearTimeout(timer);resolve(value)},error=>{clearTimeout(timer);reject(error)});
  });
  const boot=async()=>{
    stage=document.getElementById("stage");
    if(!stage || typeof window.seek!=="function" || !Number.isFinite(window.DURATION) || window.DURATION<=0 || window.DURATION>30 || stage.width<1 || stage.height<1 || stage.width>1920 || stage.height>1920)throw new Error("Invalid animation");
    await bounded(Promise.all([window.READY,document.fonts&&document.fonts.ready,...Array.from(document.images||[]).map(img=>img.decode?img.decode():Promise.resolve())]),15000);
    await bounded(window.seek(0),10000);
    send({type:"cmv:ready",duration:window.DURATION,width:stage.width,height:stage.height});
  };
  const ready=document.readyState==="loading"?new Promise((resolve,reject)=>window.addEventListener("DOMContentLoaded",()=>boot().then(resolve,reject),{once:true})):boot();
  ready.catch(fail);
  window.addEventListener("error",fail);
  window.addEventListener("unhandledrejection",fail);
  window.addEventListener("message",event=>{
    const data=event.data;
    if(event.source!==host || !data || typeof data!=="object" || data.channel!==channel)return;
    if(data.type==="cmv:export-start" && typeof data.exportId==="string"){exporting=data.exportId;return}
    if(data.type==="cmv:export-end" && data.exportId===exporting){exporting=null;return}
    if(data.type!=="cmv:seek" && data.type!=="cmv:frame")return;
    if(typeof data.time!=="number" || !Number.isFinite(data.time))return;
    if(data.type==="cmv:seek" && exporting)return;
    if(data.type==="cmv:frame" && (typeof data.requestId!=="string" || data.requestId.length>128 || data.exportId!==exporting || !exporting))return;
    queue=queue.then(async()=>{
      await ready;
      await bounded(window.seek(Math.max(0,Math.min(window.DURATION,data.time))),10000);
      if(data.type!=="cmv:frame")return;
      if(typeof createImageBitmap==="function"){
        const bitmap=await createImageBitmap(stage);
        send({type:"cmv:frame",requestId:data.requestId,bitmap,width:stage.width,height:stage.height},[bitmap]);
      }else{
        const pixels=stage.getContext("2d").getImageData(0,0,stage.width,stage.height);
        send({type:"cmv:frame",requestId:data.requestId,pixels:pixels.data,width:stage.width,height:stage.height},[pixels.data.buffer]);
      }
    }).catch(()=>{send({type:"cmv:error",requestId:data.requestId,error:"This animation could not render. Try regenerating this version."})});
  });
})();`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><meta name="referrer" content="no-referrer"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#08090b}body{display:flex;align-items:center;justify-content:center}canvas#stage{display:block;max-width:100%;max-height:100%;object-fit:contain}</style><script>${bootstrap}</script></head><body>${fragment}<script>${bridge}</script></body></html>`;
}

type FrameMessage = { type: string; requestId?: string; width: number; height: number; bitmap?: ImageBitmap; pixels?: Uint8ClampedArray; error?: string };
const activeExports = new WeakSet<HTMLIFrameElement>();

function requestFrame(iframe: HTMLIFrameElement, channel: string, exportId: string, time: number): Promise<FrameMessage> {
  const source = iframe.contentWindow;
  if (!source) return Promise.reject(new Error('The animation preview is not available.'));
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', listener); };
    const listener = (event: MessageEvent) => {
      if (!isPreviewMessage(event, source, channel)) return;
      const message = event.data as FrameMessage;
      if (message.type === 'cmv:error' && (!message.requestId || message.requestId === requestId)) {
        cleanup(); reject(new Error('The animation failed while rendering a video frame.')); return;
      }
      if (message.type !== 'cmv:frame' || message.requestId !== requestId) return;
      cleanup();
      if (!Number.isInteger(message.width) || !Number.isInteger(message.height) || message.width < 1 || message.height < 1 || message.width > 1920 || message.height > 1920) {
        message.bitmap?.close?.(); reject(new Error('The animation returned an invalid video frame.')); return;
      }
      resolve(message);
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Rendering a video frame timed out. Reload the preview and try again.')); }, 20_000);
    window.addEventListener('message', listener);
    source.postMessage({ type: 'cmv:frame', channel, exportId, requestId, time }, '*');
  });
}

/** Render every frame at its exact timestamp, applying encoder backpressure. Silent H.264 MP4. */
export async function exportMp4(iframe: HTMLIFrameElement, options: {
  channel: string; duration: number; aspect: string; onProgress?: (progress: number) => void;
}): Promise<Blob> {
  if (!Number.isFinite(options.duration) || options.duration <= 0 || options.duration > 30) throw new Error('Invalid video duration.');
  if (!iframe.sandbox.contains('allow-scripts') || iframe.sandbox.contains('allow-same-origin')) {
    throw new Error('The animation preview must run in an isolated sandbox.');
  }
  if (activeExports.has(iframe)) throw new Error('A video export is already running.');
  if (!globalThis.isSecureContext || typeof globalThis.VideoEncoder === 'undefined') {
    throw new Error('MP4 export needs a browser with WebCodecs H.264 support. Open this project in the latest Chrome or Edge over HTTPS.');
  }
  const { width, height } = videoDimensions(options.aspect);
  const { Output, Mp4OutputFormat, BufferTarget, CanvasSource, Quality, canEncodeVideo } = await import('mediabunny');
  const quality = new Quality({ bitrate: 8_000_000 });
  if (!await canEncodeVideo('avc', { width, height, frameRate: 30, quality })) {
    throw new Error('This browser cannot encode 1080p H.264 MP4. Try the latest Chrome or Edge on a supported device.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas rendering is unavailable in this browser.');
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const video = new CanvasSource(canvas, { codec: 'avc', quality, keyFrameInterval: 2 });
  output.addVideoTrack(video, { frameRate: 30 });
  const exportId = crypto.randomUUID();
  // The codec capability check above is asynchronous: another export may have
  // started since the initial check, so acquire the lock again before mutation.
  if (activeExports.has(iframe)) throw new Error('A video export is already running.');
  activeExports.add(iframe);
  iframe.contentWindow?.postMessage({ type: 'cmv:export-start', channel: options.channel, exportId }, '*');
  try {
    options.onProgress?.(0);
    await output.start();
    const count = Math.round(options.duration * 30);
    for (let index = 0; index < count; index++) {
      if (!iframe.isConnected) throw new Error('The preview was closed during export.');
      const frame = await requestFrame(iframe, options.channel, exportId, index / 30);
      context.fillStyle = '#08090b'; context.fillRect(0, 0, width, height);
      try {
        if (frame.bitmap) {
          context.drawImage(frame.bitmap, 0, 0, width, height);
        } else if (frame.pixels instanceof Uint8ClampedArray && frame.pixels.length === frame.width * frame.height * 4) {
          const staging = document.createElement('canvas');
          staging.width = frame.width; staging.height = frame.height;
          const stagingContext = staging.getContext('2d');
          if (!stagingContext) throw new Error('Canvas rendering is unavailable.');
          stagingContext.putImageData(new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height), 0, 0);
          context.drawImage(staging, 0, 0, width, height);
        } else throw new Error('The animation returned an unreadable video frame.');
        await video.add(index / 30, 1 / 30);
      } finally { frame.bitmap?.close(); }
      options.onProgress?.((index + 1) / count * 0.97);
    }
    video.close();
    await output.finalize();
    if (!target.buffer?.byteLength) throw new Error('No MP4 data was produced.');
    options.onProgress?.(1);
    return new Blob([target.buffer], { type: 'video/mp4' });
  } catch (error) {
    if (output.state !== 'finalized' && output.state !== 'canceled') await output.cancel().catch(() => undefined);
    throw error;
  } finally {
    activeExports.delete(iframe);
    iframe.contentWindow?.postMessage({ type: 'cmv:export-end', channel: options.channel, exportId }, '*');
  }
}
