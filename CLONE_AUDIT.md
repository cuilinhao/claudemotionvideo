# 本轮复刻与发布核对

审计时间：2026-10-18。范围为当前仓库代码、公开参考捕获、静态模板和素材清单；未读取 `.dev.vars`、`.secrets/`、`RECON/private/` 或真实凭据。本代理本轮只读核对文件与证据并更新文档，未自行执行构建、部署或浏览器操作；运行结果引用主代理 2026-10-18 19:37 验收及下列 RECON 记录。

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
| 生成/编辑/上传 | APIMart、Workflows、D1 账本、私有 R2；任务和请求幂等、所有权检查、失败退款。 | 既有版本有真实链路证据；本轮 UI 集成的最终生产复验 PENDING。 |
| 版本/项目 | 版本切换、分镜编辑、My videos 预览/重命名/删除/已保存 MP4。 | 本轮完整已登录浏览器回归 PENDING。 |
| 邮件/密码登录 | 本站 magic-link、密码/重置、一次性令牌、回调路径和限流。 | 代码与测试存在；本轮生产收件箱/回调验收 PENDING。 |
| Google OAuth | 后端配置检测、state/PKCE、回调和已验证邮件身份处理；项目 `claudemotionvideo`、OAuth 客户端和正式版 Audience 已创建，凭据已写入 Cloudflare 加密 secrets。 | 配置已完成；真实 Google 回调与线上账户流程 PENDING，不提前记为端到端通过。 |
| 远程数据库 | 0008 服务、0009 Google OAuth、0010 邮件验证迁移。 | 三项远程迁移均已成功应用。 |
| Stripe | 本站 Checkout/Portal/签名 Webhook、防重复事件与发点。 | 历史测试付款与正式 Checkout 页面已验证；本轮按钮/回调复验 PENDING。无真实扣款验收声明。 |
| 音频 | 原创配乐、上传、APIMart 配音、duck/fade/混音、revision 与私有读取。 | 既有真实 AAC 成片有证据；本轮弹层/移动端/导出回归 PENDING。 |
| 预览隔离 | `sandbox="allow-scripts"`、opaque origin、iframe CSP、source/channel 校验；服务端 AST 拒绝全局别名/危险访问；应用父页 `frame-src 'self'`。 | 源码已加强；浏览器验证和最终生产响应头确认由主代理记录，不能宣称形式化安全证明。 |
| 源码下载 | `.txt` + `text/plain;charset=utf-8`，只接收版本 HTML；不注入 previewAssets，不添加播放运行时。 | 回归 7/7 中覆盖该边界；最终浏览器下载检查 PENDING。 |
| 音频弹层 | 原生 dialog 限制焦点，关闭恢复触发按钮；AudioPanel 持续挂载；长文件名可换行。 | 类型检查通过；原生 dialog 的实际键盘/390px 检查 PENDING。 |

原站自动分割、CONFIG 检查器、流式追问、check/repair、评分等仅有公开前端线索，未移植其私有后台。不要把本站失败退款描述成原站所有修复或退款行为的等价实现。

## 网络与统计

- 原站 Umami、Google 统计标识和业务 islands 从运行页面中移除；`scripts/audit-reference.mjs` 检查原标识、原 API、外部资源引用、路由及不支持的产品承诺。主代理 19:37 构建与 **1,141 处引用审计通过**；生产网络复验仍 PENDING。
- 本站已有 GA4，不能继续使用旧文档“无统计脚本”的说法。`src/lib/analytics.ts` 仅在 HTTPS 生产域名与配置存在时加载本站标签，页面标题来自白名单；不上传 URL 查询/片段、提示词、邮箱或私有项目路径。历史核对在 `RECON/analytics-verification.json`；新静态桥及新路由的生产网络复验 **PENDING**。
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
| Google 与远程迁移 | VERIFIED（配置） | 项目/客户端、正式版 Audience、Cloudflare 加密凭据已完成；0008/0009/0010 远程迁移成功。真实 OAuth 流程尚未验收。 |

## 最终发布待办

1. 完成本轮已登录项目、音频弹层键盘/文件名、音频预览/导出等浏览器 QA；已有公开页面布局记录不替代这些检查。
2. 部署后逐页检查 13 个公开页面、已知 React 路由、未知路径 404、`/refund` 与 www 跳转、素材加载、canonical/sitemap/noindex 和父页 CSP。
3. 线上实测已配置的 Google OAuth 真实回调、邮件登录、客服、支付跳转及真实任务/音频/MP4 所有权；不借用原站凭据。
4. 保持 `.dev.vars*`、`.secrets/`、`.wrangler/`、`RECON/private/` 排除规则，提交前检查差异。测试记录不输出凭据或用户私有内容。

**本轮已记录的公开页响应式检查：通过。真实 Google 回调、本轮音频浏览器 QA、生产部署及线上回归：PENDING。** 详见 [CLONE_REPORT.md](CLONE_REPORT.md) 与 [TEARDOWN.md](TEARDOWN.md)。
