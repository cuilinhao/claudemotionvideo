# Claude Motion Video

基于文本和最多四张参考图生成 Canvas 动画，浏览器预览并导出含音乐/配音的 H.264 + AAC MP4。生成代码经服务端校验后保存在版本中；成片由用户浏览器逐帧渲染、编码，再上传到 Cloudflare R2。

## 技术栈与数据流

- React 19、TypeScript、Vite 7；Cloudflare Worker/Hono 提供同源 API。
- D1 保存用户、会话、积分流水、项目、任务、版本和 Stripe 事件；R2 保存原图、私有音频和 MP4；Cloudflare Workflows 执行生成任务。
- Worker 将图片内容和提示发送至 APIMart Messages 接口，由模型返回 HTML Canvas 动画和 storyboard。默认模型配置在 `wrangler.jsonc` 的 `APIMART_MODEL`（当前值 `claude-opus-5-5`）；真实单次演示信息和边界见下文。
- 上传：`POST /api/assets` 校验文件后存入私有 R2；`GET /api/assets/:id` 按登录用户校验并返回原图。
- 生成：`POST /api/jobs` 校验用户、项目、素材和幂等键，在 D1 同批记账/建 job，然后创建 Workflow。Workflow 读取图片后调用 APIMart，校验生成代码并保存 `versions`；Studio 轮询 `GET /api/jobs/:id`。
- 预览：Studio 取回版本 HTML 和授权图片数据，将内容放入仅 `allow-scripts` 的 sandbox iframe。CSP 禁止网络请求，消息桥用窗口来源及随机 channel 校验。
- MP4：`src/lib/renderer.ts` 通过 Mediabunny/WebCodecs 请求 iframe 每一帧，按 30 fps 编码 H.264，并把与预览相同的混音编码为 AAC 音轨；随后 `PUT /api/projects/:id/versions/:vid/mp4` 将二进制存 R2。后端不代用户渲染视频。
- 音频：`GET/PUT /api/projects/:id/audio` 保存混音设置与 revision；`POST /api/audio/assets` 上传带 `file`、`projectId` 的私有音频；`POST /api/projects/:id/voice` 通过 APIMart `/v1/audio/speech` 生成配音。相同幂等键不会重复调用上游；失败/中断任务按原扣点流水退款。
- 计费：Stripe Checkout/Customer Portal；Webhook 签名校验后更新订阅与积分。购买页当前套餐由 `src/lib/content.ts` 定义；生成成本由 `worker/credits.ts` 执行。

## 本地运行

要求 Node.js 24（见 `.nvmrc`）和 npm。

```sh
npm ci
npx wrangler d1 execute claudemotionvideo-db --local --file=worker/schema.sql
npm run dev
```

`npm run dev` 只启动 Vite（`127.0.0.1:5173`），并把 `/api` 代理到 `127.0.0.1:8787`。另开终端启动 Worker API：

```sh
npx wrangler dev --port 8787 --var APP_URL:http://127.0.0.1:5173
```

或者先运行 `npm run build`，再运行 `npm run preview`（Wrangler 本地托管 Worker 与 `dist` 静态文件）。若本地 D1 尚未初始化，可再次安全应用 schema：

```sh
npx wrangler d1 execute claudemotionvideo-db --local --file=worker/schema.sql
```

检查和构建：

```sh
npm run check
npm test
npm run build
```

## D1 数据模型

权威 schema 是 [`worker/schema.sql`](worker/schema.sql)。主要表：

| 表 | 用途 |
|---|---|
| `users`, `sessions`, `password_resets`, `rate_limits` | 账户、会话、重置令牌和频率限制 |
| `credit_ledger` | 不可修改的积分流水；触发器更新余额并阻止负余额 |
| `projects`, `assets`, `versions` | 项目、私有图片元数据、动画 HTML/storyboard/版本及 MP4 key |
| `audio_assets`, `project_audio`, `speech_requests` | 私有音频、项目混音设置/版本、幂等配音请求与计费状态 |
| `jobs` | 队列状态、幂等键、计费数额、版本关联 |
| `stripe_events` | 防止重复处理 Stripe webhook |

本地与远端迁移：

```sh
npx wrangler d1 execute claudemotionvideo-db --local --file=worker/schema.sql
npx wrangler d1 execute claudemotionvideo-db --remote --file=worker/schema.sql
```

`--remote` 会写入真实 D1；仅在目标数据库和执行窗口确认后使用。D1 binding 名称为 `DB`，R2 binding 为 `BUCKET`，Workflow binding 为 `GENERATION`，详见 `wrangler.jsonc`。

## 配置密钥

真实密钥只能用于授权配置，不得显示在日志、前端代码或 Git 中。Wrangler 本地开发使用项目根目录 `.dev.vars`（该文件由 `.gitignore` 排除）；按需创建并自行填值，例如：

```dotenv
APIMART_API_KEY=本机私有值
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PORTAL_CONFIGURATION=bpc_...
STRIPE_PRICES={"starter":{"month":"price_...","year":"price_..."},"pro":{"month":"price_...","year":"price_..."},"max":{"month":"price_...","year":"price_..."}}
```

Stripe 配置脚本会从 `.secrets/stripe-{test|live}-key` 读取私有 key，并把 Price ID、Portal 配置 ID 和 Webhook 签名密钥分别写到同目录的 JSON 文件。不要把这些文件贴入工单、日志或源码。`.env.example` 只有变量名/占位值，Worker 不会把 `VITE_*` 变量当作服务端密钥。

部署时通过 Cloudflare Dashboard 的 Worker Secrets 或 Wrangler 密钥命令注入服务端值：

```sh
npx wrangler secret put APIMART_API_KEY
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put STRIPE_PRICES
npx wrangler secret put STRIPE_PORTAL_CONFIGURATION
```

`STRIPE_PRICES` 是非密钥配置，但应当作为 Worker 环境变量注入且必须是完整 JSON 映射，不能暴露 Stripe secret key。也要为生产 EMAIL binding 配置发件地址/权限，否则忘记密码 API 明确返回 503，不会假称邮件已发送。

## Stripe 配置

`node scripts/configure-stripe.mjs test` 或 `node scripts/configure-stripe.mjs live` 会创建/复用 Starter、Pro、Max 的月付和年付 Price，并设置 Customer Portal；脚本要求预先将相应模式的 key 存在 `.secrets/stripe-test-key` / `.secrets/stripe-live-key`。运行后将 Price ID 映射设置为 `STRIPE_PRICES`，将 `stripe-{mode}-portal.json` 的 `id` 设置为 `STRIPE_PORTAL_CONFIGURATION`，确保客户打开的是本站的订阅管理配置。脚本定义的 USD 价格为：

| 套餐 | 月付 | 年付总额 | 每月积分 |
|---|---:|---:|---:|
| Starter | $19.90 | $166.80 | 1,500 |
| Pro | $39.90 | $286.80 | 3,600 |
| Max | $79.90 | $478.80 | 7,500 |

账单/信用卡由 Stripe 管理；首个符合条件的月付订阅可能创建 3 天试用，代码要求收集付款方式。Webhook 地址为 `https://<应用域名>/api/billing/webhook`，配置 Stripe 端点时需将签名 secret 注入 `STRIPE_WEBHOOK_SECRET`。计划订阅后需再按 Stripe 控制台完成的配置和事件列表核对 webhook 行为。

`node scripts/configure-stripe-webhook.mjs live` 会为本站创建或核对正式 Webhook；已有端点但本地缺少签名密钥时会停止，防止悄悄替换端点。受限服务端密钥需允许写入 Customers、Products、Prices、Customer Portal、Checkout Sessions、Webhook Endpoints，以及读取 Subscriptions、Invoices。生产密钥放入 Cloudflare Worker encrypted secrets；本地开发继续使用独立测试环境。

截至 2026-10-18，https://claudemotionvideo.com 已通过 Cloudflare Workers 路由上线；www 返回保留路径/查询的 301 到根域。Stripe 测试 API 已验证 Checkout、三天绑卡试用、付款发点、重复 webhook 防重和 Portal；测试订阅均已取消，无实际扣款。正式账户激活及身份验证已由持有人完成，8项权限受限密钥、6个正式Price、固定Portal配置和Webhook已接入Cloudflare encrypted secrets，生产结账已开启。正式Checkout页面验证三天绑卡试用后19.90USD/月，年付166.80USD无试用；Portal按期末取消，签名Webhook健康检查200、错误签名400。验收Checkout均已过期，未创建真实付费订阅或实际扣款；真实扣款后的Webhook交付未作生产验收。

Webhook 使用 Stripe API 版本 `2026-09-30.endive`，订阅事件：`checkout.session.completed`、`customer.subscription.created`、`customer.subscription.updated`、`customer.subscription.deleted`、`invoice.paid`、`invoice.payment_failed`、`invoice.payment_action_required`。必须使用该版本对应的 invoice parent/line price 字段；价格映射、密钥与 webhook 必须来自同一模式。正式环境不要放入测试密钥。

## 部署

先确认 Cloudflare 登录账号、D1/R2/Workflow 绑定、邮件发送权限、APIMart key、Stripe 环境和 Price ID 映射，再执行：

```sh
npm run deploy
```

此命令先构建，再运行 `wrangler deploy`。当前 `wrangler.jsonc` 声明了项目 D1/R2/Workflow 绑定、根域及 www 路由和 workers.dev；代码库内的声明并不证明自定义域路由或 Stripe 审核已完成。部署结果应在 Cloudflare Dashboard 和应用域名分别验证。

## 实际能力与限制

- 上传 PNG/JPEG/WebP，单张小于 5 MiB，每个用户最多存 200 张/累计 500 MiB；每个视频最多引用 4 张。
- 支持 10/15/30 秒、16:9/9:16/1:1。生成结果是单个 canvas 的动画代码；用户原图以完整图像像素传递，模型可缩放/裁切/移动图像，但没有自动主体分割或独立蒙版层。
- 音频：Pulse/Ambient/Uplift 三种原创合成配乐，默认 Pulse，支持关闭；可上传音乐和配音（MP3/WAV/M4A/OGG，单个最多 10 MiB、120 秒）。独立音量、配音时音乐自动降低、起止淡入淡出，长音频按视频长度裁切。
- APIMart AI 配音使用 `gpt-4o-mini-tts`，最多 600 字符，可选 Alloy/Nova/Onyx；每次成功生成扣 20 积分，失败退还。后台不自动重试上游；相同幂等键不会重复扣点。
- MP4 是客户端导出，需安全上下文与支持的 WebCodecs AVC/AAC 浏览器/设备；不支持时显示导出错误。上传大小上限 64 MiB。
- 最初静音版本的一次真实生成：10 秒 1920×1080、30 fps、H.264、5,380,655 bytes、4 shots；APIMart 单次请求约 72 秒。该记录是一次性演示，不代表服务 SLA、延迟或每次结果质量。
- 最初线上静音版本的另一次验收已完成图片上传 → Workflow → APIMart → 版本预览 → 浏览器编码 → 私有 R2：10 秒、1920×1080、30 fps、H.264、3,137,087 bytes。匿名请求成片返回 401。一次上游请求失败后已核对积分全退，随后新请求生成成功。
- 2026-10-18 音频验收：真实 APIMart 配音 7 秒、24kHz 单声道 WAV，扣点 20；浏览器混音后导出 1920×1080 / 30fps H.264 + 48kHz 双声道 AAC，5,568,623 bytes。音频平均 -20.2 dB、峰值 -2.7 dB，确认为非静音。PCM/画面严格 10 秒，AAC 编码包填充使容器显示 10.069 秒；导出不支持 AAC 的浏览器会提示错误。首页演示已使用这段音乐+AI配音样片。
- 线上音频复验：已有 V2 测试项目加载私有配音后，Chrome 导出并存回 R2 成功，MP4 3,486,434 bytes，H.264 + AAC；匿名访问音频和成片均返回 401。首页公有样片下载 SHA-256 与本地交付文件一致。
- 生成失败的任务代码会返还本次任务积分。它不构成购买订阅的通用退款承诺；购买取消/退款以当前 Stripe/应用条款与适用流程为准。
- 付款退款、拒付的积分调整目前由运营人工处理；Webhook 不会自动撤销已发积分。

更多实现记录见 [`NOTES.md`](NOTES.md)、[`TEARDOWN.md`](TEARDOWN.md)、[`CLONE_AUDIT.md`](CLONE_AUDIT.md) 和 [`REPLACE_GUIDE.md`](REPLACE_GUIDE.md)。
