# Claude Motion Video — 复刻记录

## 来源与边界

- 参考站：[Tellcut](https://tellcut.app/)。观察范围是公开首页、定价、Studio 与公开说明；未登录原站、未接触账户后台，也没有取得可授权的完整原站源码。参考截图保存在 [`RECON/screenshots`](RECON/screenshots/)；截图仅用于布局核对。
- 复刻方法：[web-clone skill](https://github.com/cuilinhao/claude-skill-web-clone)，MIT，1.6.0。公开页面和浏览器可见行为用于确认信息架构及交互，不复制原站源码、客户作品、商标素材或用户帖子。
- 这是 L6 类型 SaaS 复刻：视觉参考与独立产品实现。React/Vite 前端、Cloudflare Worker、D1/R2/Workflows、APIMart 调用和视频导出均为本仓库实现。案例页素材来自本项目生成的演示；未宣称其他模板已生成不同视频。

## 实现与运行

技术方案、本地启动、D1 初始化、密钥配置、Stripe 和部署说明见 [`README.md`](README.md)。接口见 [`docs/api-contract.md`](docs/api-contract.md)，表结构见 [`worker/schema.sql`](worker/schema.sql)。替换入口见 [`REPLACE_GUIDE.md`](REPLACE_GUIDE.md)。

## 核对与评分（截至 2026-10-18）

| 维度 | 评分 | 依据与限制 |
|---|---:|---|
| 信息架构 | 4/5 | 首页、Studio、定价、案例/效果、博客和法律页均有对应入口；见 [`src/Marketing.tsx`](src/Marketing.tsx)、[`src/Studio.tsx`](src/Studio.tsx)。 |
| 桌面视觉 | 4/5 | 已对照原站桌面截图；保存线上1512px桌面和390×844移动端截图，未做逐像素复刻评分。 |
| 交互实现 | 4/5 | 上传、异步任务、版本编辑/选 shot、预览与导出已实现；见 worker/API 链路。实际完整链路演示见下方。 |
| 成片证据 | 4/5 | 一次 APIMart 生成的演示完成：10 秒、1920×1080、H.264、30 fps、5,380,655 bytes、4 shots；耗时约 72 秒。单次结果不代表每次都能生成相同质量或耗时。 |
| 响应式与可访问性 | 3/5 | 手机首页390px无横向溢出，控件具备标签；仍未覆盖完整设备矩阵。 |
| 生产就绪度 | 4/5 | 根域HTTPS上线，www跳转正常，线上生成和MP4私有存储已验收；Stripe测试API链路通过，正式密钥、6个Price、固定Portal和Webhook已配置；正式月付/年付Checkout通过，无真实扣款。 |

最终验证：`npm run check`、`npm test`（12文件73项）、`npm run build`、`git diff --check`通过；生产依赖审计0漏洞。真实Stripe测试模式完成19.90 USD模拟付款及发点/防重/Portal验收，无实际扣款。

## 已知缺口

当前生成结果是 Canvas 动画代码，不含自动对象分割、真实多层蒙版、配音或音轨。MP4 在支持 WebCodecs H.264 的安全上下文浏览器中逐帧导出，上传至 R2；目前演示为静音视频。上传限制、套餐积分与失败生成退款以当前代码为准，不能从单个样片推导服务等级或全局退款承诺。

审计条目和资产/跟踪器检查见 [`CLONE_AUDIT.md`](CLONE_AUDIT.md)，原站公开技术拆解见 [`TEARDOWN.md`](TEARDOWN.md)。
