# Claude Motion Video Implementation Plan

> **For agentic workers:** 使用并行代理分工，主代理集成并验收。

**Goal:** 上线带真实AI生成、账号、积分订阅与MP4导出的 claudemotionvideo.com。
**Architecture:** React静态站 + Worker API + D1/R2 +持久任务；模型动画代码在隔离iframe渲染。
**Tech Stack:** React, TypeScript, Vite, Hono, Cloudflare Workers/Workflows/D1/R2, Stripe, APIMart, Mediabunny.
**Spec:** ../specs/2026-10-18-product-design.md

## Global Constraints
- 代码独立实现，原站只读研究；品牌全部换为Claude Motion Video。
- 服务端密钥，用户资源隔离，账本幂等，中文Git提交。
- 所有可见按钮必须完成动作或解释实际限制。

## Review Focus
- Webhook重放和并发生成不得重复发点或透支（backend tests）。
- 他人项目/上传/版本不可读取（backend tests）。
- 模型错误/截断/超时不得当成成功，不泄露供应商响应（AI tests）。
- 沙箱消息校验来源/nonce，输出代码不可访问本站会话（renderer tests）。
- 浏览器不支持MP4编码时显示明确提示并保留项目（browser integration）。

## Task 1: AI/渲染
- [ ] 先写并运行提取HTML/安全包装/计费输入等有效行为测试。
- [ ] worker/ai.ts：generateAnimation(env, input) → {html,storyboard,usage}；原图读R2并作为模型图像输入，max_tokens16000，流式或非流式控制超时，禁止盲重试。
- [ ] src/lib/renderer.ts：预览iframe，seek frame通信及MP4导出，真实场景与版本。
- [ ] npm test针对AI/渲染模块通过。

## Task 2: 后端与计费
- [ ] worker/schema.sql、types.ts、auth.ts、billing.ts、index.ts、workflow.ts。
- [ ] 在tests/先写原子扣退点/签名/周期发点/授权测试并观察失败。
- [ ] 按docs/api-contract.md接口实现真实API，所有响应统一JSON和错误码。
- [ ] npm test和tsc worker通过；Stripe测试事件和实际资源隔离验证。

## Task 3: 页面/编辑器
- [ ] src/main.tsx、App.tsx、pages/*、components/*、styles.css，按原站信息架构与tokens重建。
- [ ] src/lib/api.ts只调用同源/api，不包含任何供应商key。
- [ ] 原创演示与模板、响应式、空态/加载/错误态。
- [ ] 浏览器桌面/移动端、完整交互和MP4检查。

## Task 4: 部署
- [ ] Cloudflare D1/R2/Workflow和secrets、数据库迁移、构建部署。
- [ ] Stripe商家资料、6个价格、Checkout/Portal、webhook配置，测试验证。
- [ ] Namecheap域名指向Cloudflare，HTTPS、www重定向、生产检查。
- [ ] 安全审阅后中文提交推送、交付验收报告和具体未完成项。
