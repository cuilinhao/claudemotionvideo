# 本轮复刻与发布核对

审计时间：2026-10-18。范围为当前仓库代码、公开参考捕获、静态模板和素材清单；未读取 `.dev.vars`、`.secrets/`、`RECON/private/` 或真实凭据。本代理本轮只读核对文件与证据并更新文档，未自行执行构建、部署或浏览器操作；运行结果引用主代理 2026-10-18 19:37 验收、随后首轮生产部署与浏览器验收以及下列 RECON 记录。

**状态口径：** `SOURCE CHECKED` 为本地源码/文件核对；`VERIFIED` 为已记录范围内的运行检查通过；`PARTIAL` 为部分已观察证据；`PENDING` 为尚未完成的运行时或生产验收。不存在“100% 完成”评分。

## 来源、品牌和素材

| 项目 | 状态 | 证据与边界 |
|---|---|---|
| 13 个静态页面 | SOURCE CHECKED | `reference/pages/`、`scripts/build-reference.mjs`、`worker/site-routes.ts` 对应；私有 React 页面、404、重定向不计入 13 页。 |
| 470 条案例 | SOURCE CHECKED | `data/examples.json` 保留作者、X 帖子、提示与本地海报。观看跳转原帖，不把他人作品列为本站生成。 |
| 21 个效果 / 14 个 MP4 | SOURCE CHECKED | 效果来自原 Canvas ticker；MP4 为 12 场景 + 主页演示 + 登录视频。 |
| 资产存在性 | SOURCE CHECKED | manifest 567 条资产含 Fazier 徽章，本次逐项核对文件、大小与 SHA-256，缺失及不匹配均为 0。该检查不等同于全部浏览器解码/播放成功。 |
| 原始源码边界 | SOURCE CHECKED | 使用的是公开 HTML/CSS/浏览器 bundle，并未取得原站服务端或付费数据。原始捕获留在 `RECON/source/tellcut-fidelity/`，运行时素材在 `public/reference-assets/`。 |
| 品牌 | SOURCE CHECKED | 本站名称、域名和自有 favicon；静态页保留原结构，运营、隐私、计费及能力文案按本站实际修改。 |
| 原站业务模块 | SOURCE CHECKED | manifest 明确排除原 AccountMenu/account/SupportChat/Studio/MyVideos 等业务 bundle；本站使用自有 React/API 桥。 |

保留公开来源署名和资产来源记录，不将公开可获取等同于完整源码或后端授权，不宣称与原站存在品牌或业务关联。

## 业务与隔离

| 项目 | 源码实现 | 运行验收状态 |
|---|---|---|
| 生成/编辑/上传 | APIMart、Workflows、D1 账本、私有 R2；任务和请求幂等、所有权检查、失败退款。 | 既有版本有真实生成/编辑/失败返积分证据；本轮已完成现有项目的生产导出。新生成全链路没有新增本轮生产记录，不把历史证据改记为新测试。 |
| 版本/项目 | 版本切换、分镜编辑、My videos 预览/重命名/删除/已保存 MP4。 | 本轮已有 QA 项目进入及生产音频导出通过；不将其外推为所有项目/版本操作的完整组合覆盖。 |
| 邮件/密码登录 | 本站 magic-link、密码/重置、一次性令牌、回调路径和限流。 | 代码与测试存在；本轮生产收件箱/回调验收 PENDING。 |
| Google OAuth | 后端配置检测、state/PKCE、回调和已验证邮件身份处理；项目 `claudemotionvideo`、OAuth 客户端和正式版 Audience 已创建，凭据已写入 Cloudflare 加密 secrets。 | VERIFIED：真实账号仅授权 `openid email` 后回到 Pricing 并显示账户邮箱；本次无敏感 scope 或警告，截图 `production-google-success.png`。 |
| 远程数据库 | 0008 服务、0009 Google OAuth、0010 邮件验证迁移。 | 三项远程迁移均已成功应用。 |
| Stripe | 本站 Checkout/Portal/签名 Webhook、防重复事件与发点。 | VERIFIED（进入/取消）：新版界面正式 Checkout 显示 3 天试用后 $19.90/月与 1,500 credits，取消返回成功。没有真实支付/扣款，本轮不声称完成正式付款发点。 |
| 音频 | 原创配乐、上传、APIMart 配音、duck/fade/混音、revision 与私有读取。 | VERIFIED：本地与生产真实导出均为 1920×1080 H.264、AAC 48 kHz 双声道、容器 10.069333 秒；探测在 `RECON/fidelity-audio-export.json`。 |
| 预览隔离 | `sandbox="allow-scripts"`、opaque origin、iframe CSP、source/channel 校验；服务端 AST 拒绝全局别名/危险访问；应用父页 `frame-src 'self'`。 | 本地父页 CSP 阻断截图及生产 HTTP 报告已记录隔离响应头；源码和回归检查通过，不能宣称形式化安全证明。 |
| 源码下载 | `.txt` + `text/plain;charset=utf-8`，只接收版本 HTML；不注入 previewAssets，不添加播放运行时。 | 回归 7/7 中覆盖该边界；最终浏览器下载检查 PENDING。 |
| 音频弹层 | 原生 dialog 限制焦点，关闭恢复触发按钮；AudioPanel 持续挂载；长文件名可换行。 | VERIFIED：390px 显示、Esc 关闭和恢复触发按钮焦点通过；不外推所有辅助技术/设备组合。 |

原站自动分割、CONFIG 检查器、流式追问、check/repair、评分等仅有公开前端线索，未移植其私有后台。不要把本站失败退款描述成原站所有修复或退款行为的等价实现。

## 网络与统计

- 原站 Umami、Google 统计标识和业务 islands 从运行页面中移除；`scripts/audit-reference.mjs` 检查原标识、原 API、外部资源引用、路由及不支持的产品承诺。主代理 19:37 构建与 **1,141 处引用审计通过**；生产 HTTP 报告的 605 项检查通过，580 个资源大小与 SHA-256 匹配。
- 本站已有 GA4，不能继续使用旧文档“无统计脚本”的说法。`src/lib/analytics.ts` 仅在 HTTPS 生产域名与配置存在时加载本站标签，页面标题来自白名单；不上传 URL 查询/片段、提示词、邮箱或私有项目路径。历史核对在 `RECON/analytics-verification.json`；本轮 HTTP 报告确认生产统计 bundle 匹配；同时观察到 Cloudflare 边缘注入分析脚本。该脚本与 Google 登录的隐私说明已随最终版本 `cff42ef3-aa1f-42d4-9ee8-7c7a0585537b` 部署；仅更新 `/privacy/index.html`，业务 bundle 未变。
- 字体、海报、原 MP4 和效果脚本已同源化；X 作者链接是明确的外部导航。用户主动生成会把图片与提示传给 APIMart，AI 配音会发送朗读文本；Stripe、邮件及启用的 Google/GA 仍是外部服务，不能声称整个产品离线或零第三方请求。
- 公开源站的用户数、流量、收入、模型成本与实际基础设施无证据，不纳入结论。

## 已完成的本轮运行验收

| 检查 | 状态 | 证据与范围 |
|---|---|---|
| 类型、回归、构建 | VERIFIED | 主代理 2026-10-18 19:37 完整检查：类型检查、236 项测试与构建通过。 |
| 构建引用闭包 | VERIFIED | 同次 `scripts/audit-reference.mjs` 审计 1,141 处引用通过。 |
| 本地 HTTP 路由 | VERIFIED | `RECON/fidelity-local-routes.json`：18 个有效路由 200、2 个未知路由 404；父页 CSP 和私有入口 noindex 有记录。 |
| 平板布局 | VERIFIED | `RECON/fidelity-browser-layout.json`：768px、11 页，横向溢出 0、破图 0。 |
| 手机布局 | VERIFIED | 同文件：390px、9 页，横向溢出 0、破图 0；不外推未记录页面或交互。 |
| Google 与远程迁移 | VERIFIED | 项目/客户端、正式版 Audience、Cloudflare 加密凭据及 0008/0009/0010 远程迁移完成；真实 Google 授权与回调成功。 |
| 首轮生产发布 | VERIFIED | 部署 `b58dce5d`、提交 `6ea7d5b`，已推送 main。`RECON/fidelity-production-http.json` 的 605 项检查通过，580 个资源大小与 SHA-256 匹配。 |
| 音频和正式 Checkout | VERIFIED（限定范围） | 本地/生产 H.264 + AAC 导出、390px dialog/Esc/焦点恢复、正式结账进入与取消通过；没有真实支付。 |

## 最终确认与未覆盖范围

1. 最终隐私版 `cff42ef3` 已部署 Google 登录与 Cloudflare 分析说明；主代理最新构建、1,141 处引用审计与 diff 检查通过。线上证据 `RECON/fidelity-final-privacy.json`：单次 GET 200，日期、Google OpenID/email 与不访问 Gmail、Google Analytics 与 Cloudflare 自动 beacon 披露、Umami 移除、canonical 共 8 项检查全部通过。
2. 本轮没有新增邮件收件箱/客服送达、所有项目操作组合、新生成完整链路及真实正式扣款验收；保留既有测试/历史证据，不将这些未知项描述为全部通过。
3. 原站私有机制、完整设备矩阵及长期并发未验证；公开页面和真实本站业务可用，不代表与原站付费后台完全等价。
4. 保持 `.dev.vars*`、`.secrets/`、`.wrangler/`、`RECON/private/` 排除规则。文档仅记录授权范围与结果，不复制登录凭据、令牌或真实账户邮箱。

**首轮生产部署、Google 真实登录、正式 Checkout 进入/取消、本轮音频导出与 dialog 验收：通过。最终隐私版 `cff42ef3`：已部署。** 详见 [CLONE_REPORT.md](CLONE_REPORT.md) 与 [TEARDOWN.md](TEARDOWN.md)。
