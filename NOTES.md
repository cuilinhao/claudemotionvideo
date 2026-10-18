# Claude Motion Video — 界面与发布记录

## 2026-10-18：示例视频站内播放

- 用户要求示例点击后在本站观看。首页、Examples 和 Opus 5.5 专题页共用的弹窗已改为原生 MP4 播放器，提供播放/暂停、进度、声音和全屏控件，保留提示词、复制、创作入口及作者署名。
- 470 条示例对应的视频源清单位于 `public/reference-assets/data/example-media.json`。视频按需直接从作者原视频 CDN `video.twimg.com` 加载，不打开 X 页面、不加载 X iframe；这些视频没有复制进本站 R2。访客不依赖实时第三方解析请求。
- 来源由 FxEmbed 公共 API v2 解析，按海报 media ID 匹配对应视频，选 H.264 MP4、优先短边不超过 720px。维护命令：`node scripts/sync-example-media.mjs`；`--refresh` 强制刷新全部来源，`--retry-failed` 重试失败项。解析缓存仅保存在 git 忽略的 `RECON/example-media-cache/`。
- 实播发现源 CDN 对带本站 Referer 的 GET 返回 403，而不带 Referer 的 Range GET 返回 206。仅三个有示例卡片的模板采用 `meta referrer=same-origin`，保持同源来源信息、对外不发送 Referer；未修改 worker 或 CSP。
- 关闭、Esc 和离开页面均暂停并卸载播放源；加载失败可站内重试；异步响应及播放 promise 不会复活已关闭的旧视频。优先尝试带声音播放，浏览器拒绝自动播放时保留原生播放控件，不强制静音。
- 已完成类型检查、268 项测试（含 18 项播放器行为回归与 14 项来源同步回归）及构建审计。审计要求 470 个视频源全部存在、URL 和尺寸有效，且播放页面使用兼容 CDN 的 referrer 策略。
- 浏览器已实播横屏、方形、竖屏及 306 秒带 AAC 音轨的示例；验证暂停、关闭/Esc 清理、手机 390px 无横向溢出及首页/列表页面不发生站外导航。证据位于 `RECON/screenshots/inline-examples/`，来源实际 Range 请求结果见 `RECON/example-media-sync.json`。

## 2026-10-18：Claude Motion 视觉主题

- 用户要求参考 `https://claudemontiondesignskills.org/`，并先查看 `/Users/pgy/Desktop/claudemotion` 源码；保留本站功能、品牌、页面内容和视频素材。
- 以该项目的 `src/styles.css` 为视觉依据：暖白 `#faf9f5`、墨黑 `#141413`、米灰卡片、珊瑚色强调，以及 Instrument Sans、Source Serif 4、DM Mono 三套自托管字体。正文颜色略加深以保证小字对比度。
- 新增 `src/motion-theme.css`、`src/motion-studio-theme.css` 作为末层样式，覆盖 13 个公开页面、Studio、账户、项目列表、登录、客服、视频设置和音频弹窗。保留原有响应式工作台结构，调整公开页面标题、留白与圆角；favicon 只换颜色。
- worker、API、鉴权、支付、积分、视频生成、音频、渲染和业务组件均无代码变化；原演示视频、Canvas 和视频内的配色未修改。
- 验证：类型检查通过；25 个测试文件、236 项测试通过；最终构建通过；资源审计通过（13 路由、470 案例、21 效果、1,153 个本地资源引用）。12 个字体资源全部同源可用。
- 浏览器验证：1440px 首页、价格页、Studio；390px 首页、价格页、登录和音频弹窗；其余 13 个页面无横向溢出或破图，记录见 `RECON/motion-theme-layout.json`。月/年价格切换、手机导航、免费示例生成 v2、视频设置与客服弹窗正常；本轮未发起付费生成或付款。
- 截图：`RECON/screenshots/motion-theme/`。本节记录视觉改版，以下 Tellcut 复刻记录为改版前基线。
- 已发布：代码提交 `dc6346e` 已推送 `main`；Cloudflare 正式版本 `087fd610-7475-4e3c-92b1-c733c0f92574`。线上浏览器确认暖白背景和三套字体、16px 价格卡片、月付切换、Studio 及 Google 登录按钮主题正确；390px 首页无横向溢出。生产截图以 `production-` 开头，HTTP 检查见 `RECON/motion-theme-production-http.json`。

## Tellcut 复刻基线

更新：2026-10-18。本文件记录本轮 Tellcut 公开页面与 Studio 一致性改版；**本轮首个生产版本已部署，代码已推送 main；真实 Google 登录、正式 Stripe Checkout 跳转、音频弹层与本地/线上音频导出已通过验收。** 首轮部署 `b58dce5d` 对应提交 `6ea7d5b`；补充 Google 登录和 Cloudflare 分析说明的最终隐私版 `cff42ef3-aa1f-42d4-9ee8-7c7a0585537b` 已部署，仅更新 `/privacy/index.html`，业务 bundle 未变。

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
- Google OAuth 后端已实现配置检测、state/PKCE 和回调；Google Cloud 项目 `claudemotionvideo` 和 OAuth 客户端已正式创建，Audience 已设为正式版，凭据已写入 Cloudflare 加密 secrets。真实账号已通过仅 `openid email` 的授权返回 Pricing 并显示账户邮箱；本次授权未请求敏感 scope，也未出现警告。截图为 `RECON/screenshots/fidelity/production-google-success.png`。
- 真实项目支持 Pulse/Ambient/Uplift 配乐、音乐/配音上传和 APIMart AI 配音。AudioPanel 在原生弹层关闭时仍保持挂载；音频 revision 用于防止旧混音覆盖新导出。
- 支持浏览器通过 Mediabunny/WebCodecs 导出 H.264 + 可选 AAC；不支持编码时明确报错。默认原站示例与原视频保持本来音轨，不能把此前本站带声音样片当成本轮原站素材。
- 代码图标下载的是 `.txt` HTML 源码，不注入私有图片、不添加自动播放；这是刻意保留的安全差异。

## 验证状态

- 主代理于 2026-10-18 19:37 完成全量验收：类型检查通过、236 项测试通过、构建通过、1,141 处资源引用审计通过。本次文档更新未重复构建。
- 主代理已完成已记录的 1440px 本地桌面与原站截图对照。原站截图：`RECON/screenshots/fidelity/original-home-1440.png`、`original-studio-1440.png`；本站首页截图：`clone-home-1440.png`。截图不等于所有交互通过。
- 本地路由检查：`RECON/fidelity-local-routes.json` 记录 18 个有效路由返回 200、2 个未知路由返回 404，并包含父页 CSP 与私有入口 noindex。`RECON/fidelity-browser-layout.json` 记录 768px 平板 11 页、390px 手机 9 页，均无横向溢出或破图；这不是所有页面/交互的完整设备矩阵。
- 首轮生产验收见 `RECON/fidelity-production-http.json`：605 项检查通过，失败 0；580 个生产资源均与预期大小和 SHA-256 匹配，包含路由、未知路径、重定向、sitemap、robots、CSP 与统计资源检查。
- Google 真实登录成功；原 QA 账户经新版界面进入正式 Stripe Checkout，显示 3 天试用后 $19.90/月和 1,500 credits；已取消返回，未支付、未验证真实扣款。
- `RECON/fidelity-audio-export.json` 记录本地与生产导出均为 1920×1080 H.264 + AAC 48 kHz 双声道，容器时长 10.069333 秒（10 秒视频的 AAC 编码尾部约 69 ms）；原生音频 dialog 在 390px 显示、Esc 关闭及焦点恢复通过。
- 最终隐私文案已随 `cff42ef3` 部署。主代理最新 `npm run build`、1,141 处引用审计与 `git diff --check` 均通过。线上 `/privacy` GET 200，8 项检查通过，证据：`RECON/fidelity-final-privacy.json`。
- 历史生成/编辑/失败返积分、Stripe 测试及 GA4/GSC 记录见 `README.md` 与 `RECON/analytics-verification.json`；本轮发布证据以上述新报告为准。未覆盖的原站私有机制和完整设备矩阵仍保留限制。

原站私有功能差异见 [TEARDOWN.md](TEARDOWN.md)，发布记录见 [CLONE_REPORT.md](CLONE_REPORT.md)，核对清单见 [CLONE_AUDIT.md](CLONE_AUDIT.md)。运行和接口说明见 [README.md](README.md)、[docs/api-contract.md](docs/api-contract.md)。
