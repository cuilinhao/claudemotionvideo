# API contract (all routes same-origin; JSON {error:string,code?:string} on failure)

GET /api/me -> {user:null|{id,email,credits,plan,subscriptionStatus},billingEnabled:boolean}
POST /api/auth/register {email,password} /login same -> {user}; HttpOnly cookie. POST /api/auth/logout -> {ok:true}
GET /api/projects -> {projects:[{id,title,aspect,duration,createdAt,updatedAt,latestVersionId?}]}
GET /api/projects/:id -> {project,versions:[{id,html,storyboard,prompt,createdAt,assetIds:string[]}],jobs:[{id,status,error?,versionId?}]}
DELETE /api/projects/:id -> {ok:true}
POST /api/assets FormData file -> {asset:{id,url,name}}. GET /api/assets/:id -> private binary.
POST /api/jobs {prompt:string,aspect:'16:9'|'9:16'|'1:1',duration:10|15|30,assetIds:string[],projectId?:string,versionId?:string,selectedShot?:string,idempotencyKey:string} -> 202 {jobId,projectId,cost}
GET /api/jobs/:id -> {id,status:'queued'|'running'|'completed'|'failed',progress:string,error?:string,versionId?:string,projectId}
GET /api/credits -> {credits,ledger:[{amount,reason,createdAt}]}
POST /api/billing/checkout {plan:'starter'|'pro'|'max',interval:'month'|'year'} -> {url}
POST /api/billing/portal -> {url}
POST /api/billing/webhook Stripe rawbody (no auth, signature verified)
PUT /api/projects/:id/versions/:vid/mp4 video/mp4 binary -> {url}; GET corresponding /mp4 private binary.

## Shared module contracts
worker/types.ts owns Env {DB:D1Database,BUCKET:R2Bucket,GENERATION:Workflow<{jobId:string}>,ASSETS:Fetcher,APIMART_API_KEY:string,APIMART_MODEL?:string,STRIPE_SECRET_KEY?:string,STRIPE_WEBHOOK_SECRET?:string,APP_URL:string,STRIPE_PRICES?:string}.
worker/ai.ts independent provider implementation exports generateAnimation(env:{APIMART_API_KEY:string;APIMART_MODEL?:string},input:{prompt:string;aspect:string;duration:number;assets:{id:string;mediaType:string;base64:string}[];previousHtml?:string;selectedShot?:string}):Promise<{html:string;storyboard:string;usage:Record<string,number>}>. HTML uses window.ASSETS[id] dataURL, canvas#stage and window.seek(t), window.DURATION. Returned code must not embed private signedURLs.
src/lib/renderer.ts exports buildPreviewDocument(html:string,assets:Record<string,string>,channel:string):string and exportMp4(iframe:HTMLIFrameElement,options:{channel:string;duration:number;aspect:string;onProgress?:(p:number)=>void}):Promise<Blob>. Parent mounts iframe srcDoc using returned HTML, sandbox="allow-scripts", obtains "cmv:ready" and "cmv:error" postMessages with matching channel; sends {type:'cmv:seek',time,channel} forpreview; export controls frames. AI agent owns this module and documented helpers.
Shared API timestamps ISO8601 strings. HTML version assetIds resolved by frontend via authenticated GET asset Blob -> dataURL before preview.
