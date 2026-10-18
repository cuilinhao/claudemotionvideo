# Tellcut 公开源码拆解与迁移边界

更新：2026-10-18。参考 [Tellcut](https://tellcut.app/) 的公开部署产物，抓取目录为 `RECON/source/tellcut-fidelity/site/`。本轮未登录原站付费账号，未取得其服务端实现。

标记含义：**SOURCE** 为可直接检查的公开构建产物或本仓库代码；**OBSERVED** 为已记录的公开浏览器观察；**UNKNOWN** 为没有原站运行权限或服务器证据的行为。公开前端包含某个按钮/API 调用，不证明其后端实现、成本、可靠性或付费体验已被验证。

## 公开页面与素材

13 个静态路由来自原始页面结构，模板位于 `reference/pages/`：

| 路由 | 内容 |
|---|---|
| `/` | 首页、演示、场景、效果与产品说明 |
| `/pricing` | 套餐、计费选项、FAQ |
| `/examples` | 470 条公开案例的筛选、搜索、分页、详情与来源 |
| `/effects` | 21 个 Canvas 动态效果与提示 |
| `/blogs` | 博客索引 |
| `/blogs/opus-5-5-video-prompt-guide` | 提示词指南 |
| `/blogs/opus-5-5-video-examples` | 视频案例文章 |
| `/opus-5-5-video-generator` | 专题页 |
| `/featured` | Featured 页面 |
| `/contact` | 联系入口 |
| `/terms`、`/privacy`、`/refunds` | 对应本站运营主体与实际能力的政策页面 |

这 13 页不包括 React 提供的 `/studio`、`/studio/v/:id`、`/my-videos`、`/account`、`/sign-in`、`/reset-password`、404 与 `/refund` 重定向。路由边界见 `worker/site-routes.ts`。

**SOURCE：** 原 Base CSS、字体、海报、12 个场景 MP4、主页演示 MP4 和登录 MP4 已同源化。14 个 MP4 是本地视频资产数量；470 条案例是带作者、提示和原始 X 链接的数据记录，详情的观看按钮转到 X，并非本地保存 470 部视频。`manifest.json` 记录 567 项素材（含 Fazier 徽章）的来源与散列；本次文件存在性、大小与 SHA-256 核对均通过。

## Studio 的实际公开前端

主要证据：`_astro/Studio.DQsOOOob.js`、`Base.CXy0q1tT.css`、`Scenarios.BaeqU6wS.js`、`effect-ticker.CCyLZTl6.js`、`assets.DEdJlQGh.js`、`AccountMenu.BONuPb9L.js`。

| 元素 | 公开源码行为 | 当前迁移 |
|---|---|---|
| 布局 | 固定 264px 侧栏，收起后 64px；聊天在左、预览与时间轴在右；移动端重排。 | 使用原 DOM/classes 与完整 Base CSS；仅补品牌与本站功能适配 CSS。 |
| 默认示例 | Lucky spin ad；原图与提示 → 原 Canvas；10 秒、9:16。 | 使用原始动画和六张图，父页面转 data URL 后放入隔离 iframe。 |
| 示例修改 | Land on 200、More coins、Green prize；逐次累加版本，旧版本可查看。 | 保留三种原始 search/replace 修改、版本、时间轴、scope 备注；任意文字明确引导创建真实项目。 |
| 新建 | 12 个场景，格式/时长/调色板/品牌颜色、效果、最多四张图片。 | 场景与预览直接复用，选项转换为本站模型请求。 |
| 编辑 | 版本切换、按时间段选分镜、聊天修改、生成状态、导出。 | 接本站任务/版本接口；不请求原站生成服务。 |
| 账号和项目列表 | 原前端有登录、余额、套餐、My videos、账号菜单。 | 使用本站登录用户与账本；My videos 支持真实项目缩略图、重命名、删除和已保存 MP4 下载。 |

**OBSERVED：** 本轮主代理已对照公开原站和本地 1440×900 Studio，默认示例可运行。`RECON/fidelity-browser-layout.json` 另记录 768px 平板 11 页、390px 手机 9 页，横向溢出与破图均为 0；`RECON/fidelity-local-routes.json` 记录 18 个有效路由 200、2 个未知路由 404。这些检查不等于全部已登录流程或像素级验收通过。

主代理 2026-10-18 19:37 的类型检查、236 项测试、构建及 1,141 处资源引用审计均通过；远程迁移 0008/0009/0010 已成功。真实 Google 回调、本轮音频浏览器 QA 和生产部署仍 pending。

## 私有 UI 与当前实现的差异

| 原站公开 bundle 中的入口 | 本站现状 | 尚不能核验的部分 |
|---|---|---|
| Google / magic-link 登录 | 本站邮件链接和密码流程真实接 API；Google Cloud 项目 `claudemotionvideo`、OAuth 客户端、正式版 Audience 和 Cloudflare 加密凭据均已配置，真实回调与线上登录实测 pending。 | 原站账号绑定、Google 回调和邮件送达实际行为。 |
| 流式生成进度、模型追问/选项回复 | 本站持久任务加轮询，显示真实 progress；没有伪造原站的流式 token 或多轮问卷。 | 原站私有协议、收费时点与追问策略。 |
| 画布文字/颜色 CONFIG 检查器 | 本站初始设置和聊天编辑可改变结果；未移植原站 CONFIG 原地编辑/持久化端点。 | 原站手动修改与版本保存的全部规则。 |
| 图片分析、区域选择、cutout/mask 请求 | 本站发送原始像素，支持模型 drawImage、移动和矩形裁切；没有自动分割服务。 | 原站分割模型、蒙版质量、收费与数据处理。 |
| check / repair、点赞/点踩与原因 | 本站有生成校验和失败退积分；未实现原站专门的自动回看修复与评分端点。 | 原站自动检查、免费修复额度与评分处理。 |
| Studio 标题直接修改 | 本站可在 My videos 重命名；Studio 标题当前只读。 | 原站登录后所有标题编辑状态。 |
| 下载可执行 HTML | 本站只提供 `.txt` 源码下载，不自动执行模型代码，也不注入私有素材。 | 此为明确的安全差异，不算同功能复刻。 |
| 已登录默认打开最近项目 | 本站 `/studio` 默认 Lucky spin；已有项目可通过列表和深链接进入。 | 原站不同账户、空项目和缓存场景下的实际默认状态。 |
| 声音 | 本站真实项目额外提供音乐、上传音频、AI 配音与 AAC；默认示例保持无声。 | 原站付费项目是否有其他声音能力，不能从公开演示推断。 |

原站生产账单、Google 账号、付费项目列表、服务限额和故障恢复均没有原站登录态验收证据。迁移后的本站接口可验证，但不能据此宣称与其私有后台完全一致。

## 本站技术路径

**SOURCE：** React/Vite 连接同源 Worker/Hono API。D1 保存账号、会话、项目、版本、积分和事件；R2 保存私有图片/音频/成片；Workflows 执行 APIMart 请求；Stripe 管理订阅与付款；邮件服务处理登录链接、重置和客服。

生成使用 APIMart `/v1/messages`，默认 `claude-opus-5-5`，要求确定性的 `canvas#stage`、`window.seek(t)`、`window.DURATION` 与 `window.ASSETS`。服务端验证脚本；预览使用 opaque sandbox iframe、限制 CSP、来源及随机 channel 检查。MP4 在浏览器按 1080p、30fps 编码，音轨可为 AAC，随后上传私有 R2。上述事实描述本站，并不能证明 Tellcut 使用同一提供商、提示或存储架构。

已记录的四个原站 MP4 音轨抽查：Studio 演示、launch、game、showreel 均为 H.264 视频单轨；此结果只覆盖这四个文件，不能外推所有原站成片。本站带音乐/AI 配音的真实导出证据记录在 `README.md`，其样片与本轮原始参考素材分别保留。
