# SEO / GEO 验收记录

验收日期：2026-10-18（Asia/Shanghai）。目标仓库：claudemotionvideo；交付分支：`codex/text-animation-seo`。按用户 AGENTS.md 使用中文提交信息。此次只改站内 SEO 内容、静态页面构建与公开路由识别，不改生成、支付或定价逻辑。

## 按任务书逐条验收

- [x] 首页 Title 为 `Text Animation Generator — Animate Text & Titles With AI`。
- [x] 首页 H1 为 `Text animation generator`。
- [x] `ai motion graphics` 不在首页 Title / H1，正文仅保留一次自然提及。
- [x] `/text-animation-generator` 返回 200，Title/H1/canonical 正确；含 98 词介绍、三步有序列表、真实规格、8 个效果内链、5 条 FAQ 和定价 CTA。
- [x] `/animated-title-generator` 返回 200，Title/H1/canonical 正确；含 101 词介绍，开场、章节、lower third 和片尾场景，正文与 FAQ 独立。
- [x] 8 个 `/effects/*` 页面全部返回 200，各含 50–80 词介绍、原样 prompt、动态效果预览及真实社区示例视频。视频注明作者、来源和经核实的原帖日期；非精确对应的视频明确标为 related example。
- [x] `/llms.txt` 和 `/llms-full.txt` 返回 200，Content-Type 为 `text/plain; charset=utf-8`。完整语料在构建时同步。
- [x] 首页 JSON-LD 已实际运行 Google Rich Results Test：1 项有效 SoftwareApplication，无严重错误；缺少 `aggregateRating` 是一个非严重问题。没有编造评分。
- [x] FAQPage 的 8 个问答与可见文本逐字一致，首页及两个工具页均含 HowTo。Google 已撤下 FAQ/HowTo 富结果支持，因此它们不会出现在当前 Rich Results Test 的识别项目中；不能按旧任务书要求勾选“二者均被该工具展示”。
- [x] 从 8 个生成页面读取的全部 VideoObject 联合提交 Google Code 模式检测，返回 8 项有效视频，无严重错误。此项验证的是标记，不等于上线后的抓取与视频收录。
- [x] 首页及 10 个新增页面均指向真实 1200×630 PNG，Twitter card 为 `summary_large_image`，apple-touch-icon 仍为 favicon.svg。
- [ ] 在 X/Twitter Card Validator 中看到上线卡片：入口实际重定向到 X 登录；正式站已部署，11 张公开分享图的 HTTP 响应和尺寸已验证；仍需负责人使用 X 登录会话确认平台卡片预览。
- [x] sitemap 恰含 23 个 URL，各有 lastmod；首页/pricing/examples/effects 为 weekly，其余 monthly。
- [x] 原有 13 个公开 URL 和 10 个新增 URL 全部 200；首页及新页面抽取到的 22 个内部目标均无 404。不存在的效果 URL 仍为 404。
- [x] 本地首页 Lighthouse 13.5.0 SEO 改造前 100、改造后 100，均高于任务书给出的 93；无失败的计分 SEO 审计。
- [x] 10 个新页面均含可见面包屑和 BreadcrumbList；首页在步骤之后各链接两个工具页一次；examples/effects 顶部增加工具入口；每个效果页链接其他 7 个效果。
- [x] `robots.txt` 字节内容保持不变；未新增 hreflang、robots meta、虚构评分或隐藏的 SEO 正文。保留所有现有 slug 与页面。
- [x] README 已写入品牌决策边界、禁止无内容的多语言标签、禁止隐藏正文、保持 robots.txt 以及合并部署后的人工 GSC 操作。

## 可复核证据

- [首页 Google 检测结果](https://search.google.com/test/rich-results/result?id=hudL7qPp0CmBLM8o_FpzFQ)：1 项有效软件应用；唯一非严重问题为缺少真实评分。
- [8 个视频标记 Google 检测结果](https://search.google.com/test/rich-results/result?id=3u66GVKsN72tyoJeyxK0aw)：8 项有效视频。
- [Google 视频检测截图](evidence/rich-results-videos.png)。Google 结果链接可能过期，因此保留截图。
- [HTTP 验收明细](evidence/http-audit.json)：所有路由、响应类型、分享图尺寸与内部链接。
- [Lighthouse 前后对照](evidence/lighthouse-summary.json)。Lighthouse 的 structured-data 项是人工检查项，不将 SEO 100 分当作 Schema 验证。
- [工具页截图](evidence/text-tool.png)。

外部视频用 Range 请求验证，五个不同 MP4 地址全部返回 `206 video/mp4`。独立审查发现干净检出时不能依赖未提交模板中的 referrer 设置；新页面现在显式生成 `same-origin`，并有去掉源模板 meta 后的回归测试。

## 验证命令

```sh
npm run check
npm test
npm run build
node scripts/audit-seo.mjs http://127.0.0.1:8790
```

当前工作目录的完整测试、类型检查和构建均通过；原有未提交的示例播放器改动保留，未纳入本次 SEO 提交。另行验证提交快照的干净构建，避免依赖未提交文件。详见本文件末尾的最终验证结果。

## 任务书口径与现状差异

- 原站是 Vite + Cloudflare Worker 的静态 HTML，不是 Next.js。新增路由由构建脚本生成，并在 Worker 公开路径表登记；交付效果是相同的十个独立可索引 URL。
- 原效果库实际有 21 个演示；本次按任务书为指定的 8 个创建独立页，其他内容保留。
- Google 的 [FAQ 更新记录](https://developers.google.com/search/updates) 与 [HowTo 停用说明](https://developers.google.com/search/blog/2023/08/howto-faq-changes) 已改变旧验收标准。保留请求的 Schema.org 类型，但不声称 Google 会展示已停止支持的富结果。
- 首页中第三方社区原始投稿保持来源内容；新写的页面、产品文案及 llms 语料均为英文。
- GSC 提交、请求收录、观察 2–4 周及外链分发仍是任务书明确划定的人工后续工作。用户随后明确授权测试、合并 GitHub 并上线，已按下方记录完成正式发布。

## 最终验证结果

- 原工作目录：类型检查通过，32 个测试文件 / 299 个测试通过，构建成功。
- 精确暂存树导出的干净目录：独立 `npm ci` 成功（145 个包、0 漏洞），类型检查通过，30 个测试文件 / 267 个测试通过，构建成功。两组数量差异来自原工作目录中保留的未提交示例播放器测试。
- 干净构建产出全部 23 个公开文档、23 条 sitemap 记录和 11 张 1200×630 PNG。llms-full 的构建前、构建后、public/dist 和重复生成 SHA-256 均为 `1b6a7c114a0e728085ba37d38d8633ccd035fabcacea5e93407536ec171e1d57`。
- 浏览器实测社区视频播放至 15.061 秒结束，readyState 4、1280 像素宽、无媒体错误；[效果页截图](evidence/effect-preview.png)。
- 独立审查结论：referrer 依赖问题已修复，无未解决的可操作问题。

## 正式发布验收（用户追加授权后）

- GitHub PR #1 已合并到 `main`，部署代码提交为 `969a5f9ef95fd9a79a3fda9fd7d78f51d8ff0319`。
- 将 SEO 分支与最新 `main`（含站内示例播放器）合并到独立干净目录后，`npm ci` 报告 0 漏洞；类型检查、32 个测试文件 / 299 个测试、生产构建和 Wrangler dry-run 全部通过。GitHub 合并后的树与已测试的树完全一致。
- Cloudflare 正式版本：`eab5cc7e-627c-4963-9b16-1d630db1daea`；上一版本为 `2936f267-537e-4218-b121-46a546d5ce07`。继续使用既有域名、D1、R2、Workflow、定时任务及 Secrets。
- [正式站](https://claudemotionvideo.com/) 上的 23 个公开页面全部 200；11 张分享图均为 1200×630；22 个内部链接无 404；两个 llms 文件返回 text/plain；robots 保持不变；不存在的效果页仍为 404。详见 [正式站 HTTP 审计](evidence/production-http-audit.json)。
- 正式站 Lighthouse SEO 为 100，无失败的计分 SEO 审计。
- 浏览器从首页点击进入 Letter drop 页面，实播社区视频至 15.061333 秒结束，readyState 4、宽 1280、无媒体错误。合并后的示例页弹窗也已复查。
- `/api/me` 返回 200，支付及邮箱/Google 登录配置均已启用；未登录访问 `/api/projects` 正确返回 401；`/studio` 返回 200；www 正确 301 跳转主域名。这是非交易健康检查，未执行扣费或付费生成。
- 首页经过现有 Worker canonical 格式化后与发布构建一致，播放器脚本、470 条媒体映射及 llms-full 的 SHA-256 与构建产物一致。详见 [上线摘要](evidence/production-release.json)。
- [正式首页截图](evidence/production-home.png)；[正式效果页截图](evidence/production-effect.png)。

X 登录态下的卡片预览及任务书明确的人工 GSC 后续仍单独保留，不将部署成功等同于搜索引擎收录。
