# Tellcut 页面与 Studio 一致性实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement the independent page, asset, and Studio tasks. Keep existing production services working.

**Goal:** 保留 Claude Motion Video 品牌，其余公开页面、演示素材、布局和交互按 Tellcut 实际部署源码复刻。

**Architecture:** 公开 Astro 页面使用清理后的真实 HTML、CSS、视觉脚本及同源媒体。React 独立入口提供本站鉴权、付款、客服和 Studio；生成、保存、音频与导出沿用现有 Cloudflare/APIMart/Stripe 服务。

**Tech Stack:** React 19、Vite 7、TypeScript、Cloudflare Workers/D1/R2、APIMart、Stripe。

**Spec:** 用户 2026-10-18 的逐页一致要求及“保留我的品牌，其余按原站复刻”确认；基准位于 RECON/source/tellcut-fidelity。

**验收更新：2026-10-18 最终隐私版发布后。** 主代理已完成类型检查、236 项测试、构建与 1,141 处资源引用审计；本地 18 个有效路由 200、2 个未知路由 404，平板 11 页/手机 9 页无横向溢出或破图。首轮部署 `b58dce5d` / 提交 `6ea7d5b` 成功且已推送 main；生产 HTTP 605 项检查、580 个资源散列匹配通过。真实 Google 登录、正式 Checkout 进入/取消、音频弹层和本地/生产音频导出通过。最终隐私版 `cff42ef3-aa1f-42d4-9ee8-7c7a0585537b` 已部署，仅更新 `/privacy/index.html`，业务 bundle 未变；不能据此宣称全功能或 100% 完整复刻。

## Global Constraints

- 所有提交信息使用中文。
- 使用真源码与真实素材，不用近似图替换演示视频；保留 X 案例的创作者和来源署名。
- 不加载原站账号、付款、客服接口或统计脚本。保留仓库同时进行的本站 SEO/统计改动。
- 原站默认演示保持原本无声；用户自己的项目继续支持已实现的背景音乐和配音。
- 不将未验证的付费后端行为描述为已完整复刻。

## Review Focus

- HTML 和视觉脚本引用全部同源且无缺失；字体、poster 与视频均可加载。
- 登录/付款回调只接受本站路径，鉴权和付款保持真实有效。
- 未知博客详情应返回 404，不以另一篇文章顶替。
- 移动导航、案例筛选、弹窗、播放、Studio 按钮键盘均能操作。
- 音频/版本/项目切换、导出以及未登录权限不能因换 UI 回归。

### Task 1: 真实资产与静态页面

**Files:** public/reference-assets/**、reference/pages/**、scripts/build-reference.mjs。

- [x] 复制 13 个公开静态页面和纯视觉依赖，保留 Claude Motion Video 品牌并清除原站追踪和业务 islands。
- [x] 同源化 12 个场景、主页录屏、登录视频（共 14 个 MP4）、字体、470 条案例海报与 21 项动效。manifest 当前 567 项，含 Fazier 徽章；文件、大小和 SHA-256 核对无缺失或不匹配。
- [x] 构建完整路由并通过 1,141 处引用审计；`RECON/fidelity-local-routes.json` 记录 18 个有效路由 200、2 个未知路由 404。

### Task 2: 本站业务桥接

**Files:** src/AuthModal.tsx、src/FidelityChrome.tsx、src/reference-main.tsx、src/AccountPage.tsx、worker/magic-link.ts、worker/support.ts、worker/app.ts。

- [x] 按原 DOM/classes 重建登录/账号/客服，连接本站 API。
- [x] 补一次性邮件登录与客服提交，覆盖 token 到期/重放/重定向/限流和发送失败的测试。
- [x] data-checkout 按钮连接现有 Stripe Checkout；同步登录和 credits，并防止旧 me 请求覆盖退出或新登录状态。
- [x] Google Cloud 项目 `claudemotionvideo` 和 OAuth 客户端正式创建，Audience 设为正式版，凭据写入 Cloudflare 加密 secrets。
- [x] 远程迁移 `0008_fidelity_services.sql`、`0009_google_oauth.sql`、`0010_email_verification.sql` 成功应用。
- [x] 真实 Google 账号仅授权 `openid email`，成功回到 Pricing 并显示账户邮箱；本次无敏感 scope 或警告，证据为 `RECON/screenshots/fidelity/production-google-success.png`。
- [x] 原 QA 账户通过新版界面进入正式 Stripe Checkout，显示 3 天试用后 $19.90/月、1,500 credits；已取消返回，没有支付，不记为正式扣款或付费发点验收。

### Task 3: Studio 与真实演示

**Files:** src/Studio.tsx、src/studio-fidelity.css、src/lib/tellcut-demo.ts、src/lib/renderer.ts。

- [x] 复原侧栏、聊天、预览、版本与时间线布局；迁移 Lucky spin 真实代码和图片，默认示例可运行。
- [x] 将真实生成、上传、历史和导出接到原样控件；音频放在项目工具中；HTML 源码下载改为不执行、不注入私有素材的 .txt。
- [x] 保留生成/失败、项目切换、音频 revision 和隔离保护的实现与回归检查。
- [x] 390px 原生音频 dialog 显示、Esc 关闭和焦点恢复通过；本地/生产真实项目音频导出均完成。
- [x] `RECON/fidelity-audio-export.json` 记录两次导出均为 1920×1080 H.264 + AAC 48 kHz 双声道，容器时长 10.069333 秒；约 69 ms AAC 尾部填充按实记录。

### Task 4: 集成、验证与发布

**Files:** App.tsx、main.tsx、reference.html、vite.config.ts、package.json、worker/index.ts、NOTES.md、CLONE_REPORT.md、CLONE_AUDIT.md。

- [x] 主代理 19:37 完成类型检查、全量 236 项回归/安全测试和构建。
- [x] 保存 1440px 桌面对照和原站/本站截图；`RECON/fidelity-browser-layout.json` 记录 768px 平板 11 页、390px 手机 9 页，均无横向溢出或破图。
- [x] 四份验收文档已区分源码实现、实际验证范围与私有原站能力未知项；未将公开页面布局检查外推为全部交互或设备通过。
- [x] 本轮 Google 回调、正式 Stripe 跳转/取消、Studio 音频导出及 dialog 浏览器 QA 按上述覆盖通过；不外推未记录交互。
- [x] 首轮部署 `b58dce5d-7274-40b5-bd2f-61cbfb86ae0a` 成功；`RECON/fidelity-production-http.json` 记录 605 项检查、失败 0，580 个生产资源大小/SHA-256 匹配，含页面、未知路由、重定向、CSP、canonical/sitemap/noindex、统计资源等检查。
- [x] 首轮代码提交 `6ea7d5b` 已推送 main；四份文档已补本轮生产证据，保留原站私有机制与真实支付验收限制。
- [x] 最终隐私版 `cff42ef3` 已部署 Google 登录与 Cloudflare 边缘分析脚本说明；Wrangler 仅上传 `/privacy/index.html` 一个新资产，业务 bundle 未变；主代理最新构建、1,141 处引用审计与 diff 检查通过。`RECON/fidelity-final-privacy.json` 记录线上 GET 200，8 项检查全部通过。

**未覆盖范围：** 本轮未新增邮件收件箱/客服送达、所有项目操作组合、新生成完整链路、真实正式扣款及完整设备矩阵的生产验收。已有历史测试与真实业务证据继续保留；原站流式追问、CONFIG 检查器、自动分割、check/repair、评分等私有机制未声称实现或核验。
