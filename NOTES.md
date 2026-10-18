# Claude Motion Video — 当前复刻记录

更新：2026-10-18。本文件记录本轮 Tellcut 公开页面与 Studio 一致性改版；**本地构建、测试、路由与已记录的响应式检查通过；真实 Google 回调、本轮音频浏览器 QA 和生产部署仍为 pending**。此前已上线版本的生成、音频、Stripe 与统计验收，不等于本轮改版已发布。

## 来源和实现边界

- 用户确认保留 Claude Motion Video 名称、域名与自有 favicon，其余公开页面、素材和 UI 依据 Tellcut 实际部署源码移植。
- 原始公开 HTML、CSS、浏览器模块与素材保存在 `RECON/source/tellcut-fidelity/`。已获得的是浏览器公开构建产物，不是 Tellcut 的服务端源码、完整源码仓库或付费账号访问权。
- 本轮已使用原始演示素材和公开案例数据；旧记录中的“未复制原站素材”“所有案例为本站生成”不再适用。案例保留创作者、X 来源与原始提示词归属，不表示由 Claude Motion Video 生成。
- 复刻依据实际源码和截图，方法参考 [web-clone skill](https://github.com/cuilinhao/claude-skill-web-clone)。本站业务继续使用自有 Cloudflare、APIMart、Stripe 和邮件服务，不连接原站业务 API。

## 已核对的源码与素材规模

| 范围 | 当前实现与证据 |
|---|---|
| 13 个静态页面 | `reference/pages/` 与 `scripts/build-reference.mjs`：首页、Pricing、Examples、Effects、Blogs、两篇博客、Featured、Contact、Terms、Privacy、Refunds、Opus 5.5 专题页。 |
| 470 条公开案例 | `public/reference-assets/data/examples.json`，每条保留作者和 X 链接；海报同源化，观看入口跳转原作者 X 帖子。不是 470 个本站生成或本地视频文件。 |
| 21 个动态效果 | 原 `effect-ticker.CCyLZTl6.js` 的 Canvas 预览及配方；Studio 将所选效果接入本站生成提示。 |
| 14 个原站 MP4 | 12 个场景视频、1 个主页 Studio 演示、1 个登录视频；均在 `public/reference-assets/`。 |
| 默认 Lucky spin | 原 Canvas 动画、六张原始图、Baloo 2 字体和三种累加修改；10 秒、9:16、无声音。 |
| 素材清单 | `public/reference-assets/manifest.json` 记录 567 条素材来源、大小与散列。本次核对含 Fazier 徽章的全部文件、大小与 SHA-256，缺失和不匹配均为 0；主代理构建审计的 1,141 处资源引用通过。 |

静态页面保留原布局与 CSS；需要反映本站真实能力、运营主体或安全边界的文案已调整，不能据此声称所有文字逐字一致。

## 本站真实业务

- React Studio 保留项目、版本、图片上传、任务轮询、选分镜编辑、预览和 MP4 导出。默认示例免费运行，任意自由修改引导用户创建自己的项目，不伪造 AI 结果。
- `worker/ai.ts` 使用 APIMart 原生 Messages 接口和 `claude-opus-5-5`；图片以实际 Base64 内容发送。D1 记录任务与积分，Workflows 执行请求，R2 保存私有素材和成片。
- 原站账号、付款、客服 islands 已替换为本站实现：邮件登录、密码登录/重置、账户积分、项目列表/重命名/删除、Stripe Checkout/Portal、客服提交。远程 D1 迁移 `0008_fidelity_services`、`0009_google_oauth`、`0010_email_verification` 已成功执行。
- Google OAuth 后端已实现配置检测、state/PKCE 和回调；Google Cloud 项目 `claudemotionvideo` 和 OAuth 客户端已正式创建，Audience 已设为正式版，凭据已写入 Cloudflare 加密 secrets。**真实 Google 回调与线上登录实测 pending**。
- 真实项目支持 Pulse/Ambient/Uplift 配乐、音乐/配音上传和 APIMart AI 配音。AudioPanel 在原生弹层关闭时仍保持挂载；音频 revision 用于防止旧混音覆盖新导出。
- 支持浏览器通过 Mediabunny/WebCodecs 导出 H.264 + 可选 AAC；不支持编码时明确报错。默认原站示例与原视频保持本来音轨，不能把此前本站带声音样片当成本轮原站素材。
- 代码图标下载的是 `.txt` HTML 源码，不注入私有图片、不添加自动播放；这是刻意保留的安全差异。

## 验证状态

- 主代理于 2026-10-18 19:37 完成全量验收：类型检查通过、236 项测试通过、构建通过、1,141 处资源引用审计通过。本次文档更新未重复构建。
- 主代理已完成已记录的 1440px 本地桌面与原站截图对照。原站截图：`RECON/screenshots/fidelity/original-home-1440.png`、`original-studio-1440.png`；本站首页截图：`clone-home-1440.png`。截图不等于所有交互通过。
- 本地路由检查：`RECON/fidelity-local-routes.json` 记录 18 个有效路由返回 200、2 个未知路由返回 404，并包含父页 CSP 与私有入口 noindex。`RECON/fidelity-browser-layout.json` 记录 768px 平板 11 页、390px 手机 9 页，均无横向溢出或破图；这不是所有页面/交互的完整设备矩阵。
- **pending：** 真实 Google 回调与线上登录、本轮已登录项目/音频弹层及音频导出浏览器 QA、本轮生产部署与线上业务回归。
- 历史生产生成/音频、Stripe 测试及正式 Checkout 页面、GA4/GSC 记录见 `README.md` 与 `RECON/analytics-verification.json`；不沿用为本轮改版的上线证明。

原站私有功能差异见 [TEARDOWN.md](TEARDOWN.md)，发布记录见 [CLONE_REPORT.md](CLONE_REPORT.md)，核对清单见 [CLONE_AUDIT.md](CLONE_AUDIT.md)。运行和接口说明见 [README.md](README.md)、[docs/api-contract.md](docs/api-contract.md)。
