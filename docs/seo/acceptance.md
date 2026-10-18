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
- [ ] 在 X/Twitter Card Validator 中看到上线卡片：入口实际重定向到 X 登录；本次代码尚未部署到正式域名，不能把本地图片验证冒充线上卡片预览。部署后由负责人使用登录会话复验。
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
- GSC 提交、请求收录、观察 2–4 周及外链分发仍是任务书明确划定的人工后续工作。本次不擅自合并或发布生产环境。

## 最终验证结果

- 原工作目录：类型检查通过，32 个测试文件 / 299 个测试通过，构建成功。
- 精确暂存树导出的干净目录：独立 `npm ci` 成功（145 个包、0 漏洞），类型检查通过，30 个测试文件 / 267 个测试通过，构建成功。两组数量差异来自原工作目录中保留的未提交示例播放器测试。
- 干净构建产出全部 23 个公开文档、23 条 sitemap 记录和 11 张 1200×630 PNG。llms-full 的构建前、构建后、public/dist 和重复生成 SHA-256 均为 `1b6a7c114a0e728085ba37d38d8633ccd035fabcacea5e93407536ec171e1d57`。
- 浏览器实测社区视频播放至 15.061 秒结束，readyState 4、1280 像素宽、无媒体错误；[效果页截图](evidence/effect-preview.png)。
- 独立审查结论：referrer 依赖问题已修复，无未解决的可操作问题。
