import {readFile} from 'node:fs/promises';
import {PUBLIC_PAGE_PATHS} from '../worker/site-routes.ts';
import {toolPages} from './seo/tool-content.mjs';
import {effectRoutes} from './seo/effect-routes.mjs';
import {origin,plainText} from './seo/shared.mjs';
const base=new URL(process.argv[2] || 'http://127.0.0.1:8790');
const failures=[];
const require=(condition,message)=>{if(!condition) failures.push(message);};
const get=async(path)=>{const response=await fetch(new URL(path,base),{signal:AbortSignal.timeout(20000)});return {response,body:await response.text()};};
const reports=await Promise.all([...PUBLIC_PAGE_PATHS].map(async path=>{
  const {response,body}=await get(path);
  require(response.status===200,`${path}: HTTP ${response.status}`);
  require(!/noindex/i.test(response.headers.get('X-Robots-Tag') || ''),`${path}: unexpected noindex`);
  require(body.includes(`rel="canonical" href="${origin+path}"`),`${path}: incorrect canonical`);
  const schemas=[...body.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map(m=>{try{return JSON.parse(m[1]);}catch{failures.push(`${path}: invalid JSON-LD`);return {};}});
  return {path,status:response.status,title:plainText(body.match(/<title>(.*?)<\/title>/)?.[1] || ''),schemas:schemas.map(s=>s['@type']),body};
}));
const sitemap=await get('/sitemap.xml');
const locations=[...sitemap.body.matchAll(/<loc>(.*?)<\/loc>/g)].map(m=>new URL(m[1]).pathname);
require(JSON.stringify(locations.sort())===JSON.stringify([...PUBLIC_PAGE_PATHS].sort()),'Sitemap must contain exactly the twenty-three public routes');
require([...sitemap.body.matchAll(/<lastmod>/g)].length===23,'Sitemap must date every route');
const texts=[];
for(const path of ['/llms.txt','/llms-full.txt']){const {response,body}=await get(path);require(response.status===200 && /^text\/plain/.test(response.headers.get('content-type') || ''),`${path}: must return 200 text/plain`);texts.push({path,status:response.status,contentType:response.headers.get('content-type'),bytes:Buffer.byteLength(body)});}
const robots=await get('/robots.txt');
require(robots.body===await readFile(new URL('../public/robots.txt',import.meta.url),'utf8'),'robots.txt differs from source');
const paths=['/',...toolPages.map(x=>x.path),...effectRoutes.map(x=>'/effects/'+x.slug)];
const images=[];
const links=new Set();
for(const path of paths){
  const page=reports.find(x=>x.path===path);
  require([...page.body.matchAll(/<h1\b/g)].length===1,`${path}: expected one H1`);
  const image=page.body.match(/<meta property="og:image" content="([^"]+)"/)[1];
  require(image.startsWith(origin+'/og/') && image.endsWith('.png'),`${path}: PNG sharing image missing`);
  const response=await fetch(new URL(new URL(image).pathname,base));const data=Buffer.from(await response.arrayBuffer());
  const width=data.length>=24?data.readUInt32BE(16):0,height=data.length>=24?data.readUInt32BE(20):0;
  require(response.status===200 && width===1200 && height===630,`${path}: incorrect image dimensions or response`);
  images.push({path:new URL(image).pathname,status:response.status,width,height});
  for(const [,href] of page.body.matchAll(/<a\b[^>]*href="([^"]+)"/g)){
    if(!href.startsWith('/') || href.startsWith('//')) continue;
    const url=new URL(href,base);links.add(url.pathname);
  }
}
const linkResults=await Promise.all([...links].map(async path=>{const response=await fetch(new URL(path,base),{signal:AbortSignal.timeout(20000)});require(response.status!==404,`Broken internal link: ${path}`);return {path,status:response.status};}));
const missing=await get('/effects/not-a-real-effect');require(missing.response.status===404,'Unknown effects must remain 404');
const result={base:base.origin,date:new Date().toISOString(),pages:reports.map(({body,...report})=>report),texts,images,internalLinks:linkResults,robotsUnchanged:robots.body===await readFile(new URL('../public/robots.txt',import.meta.url),'utf8'),unknownRouteStatus:missing.response.status,failures};
console.log(JSON.stringify(result,null,2));if(failures.length) process.exitCode=1;
