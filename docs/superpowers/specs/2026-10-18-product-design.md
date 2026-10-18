# Claude Motion Video 产品设计

用户已指定复刻 Tellcut 并直接部署，供应商 APIMart、域名 claudemotionvideo.com、Cloudflare 和 Stripe，仓库 cuilinhao/claudemotionvideo。使用用户指定 web-clone skill 1.6.0，采用 L6 视觉复刻与独立功能实现。首页黑底、橙红强调色、压缩大写标题、网格背景、双列视频展示；Studio 三列（项目、对话、预览）和时间轴。保留首页/定价/示例/效果/博客/法律/联系页结构；素材为本项目原创演示。

## 架构
Vite React TypeScript 前端；Cloudflare Workers + Hono API；D1 用户/会话/积分账本/项目/版本/任务/Stripe事件；R2 私有上传与视频；Cloudflare Workflows 持久生成任务。APIMart native Anthropic /v1/messages 输出分镜与独立 Canvas HTML，沙箱 iframe 执行确定性 seek(t)，Mediabunny 编码1080pMP4。上传图片作为 data URI 注入白名单资产，不允许模型代码联网或访问账号。

## 首发功能
邮箱密码注册登录（PBKDF2+随机盐，HttpOnly会话），最多4图、10/15/30秒、16:9/9:16/1:1；自然语言生成/修改、分镜范围选择、版本保存与回退、我的视频、真实任务状态、导出下载。生成模型优先 claude-opus-5-5，以实际测试为准。图像可移动/缩放/裁切；自动物体分割不冒充已实现。

## 计费
USD月付 Starter19.90/1500、Pro39.90/3600、Max79.90/7500，年付166.80/286.80/478.80且按月发点。10秒80、15秒100、30秒160；首图+60，额外图+20；文字编辑20，含图编辑40且新增图+20。月付首次3天300点试用需Stripe绑卡；普通注册0点。失败返还，余额最多月额度2倍。Stripe Checkout、Customer Portal、签名webhook、事件/发点唯一键及账本幂等，原子扣点避免并发超用。真实支付上线必须账户可收款；无法通过验证则如实保留待办。

## 安全与验收
所有密钥服务端secret，禁入Git/前端。所有资源按userId隔离，跨站写入检查Origin，登录/注册限速，上传格式/大小验证。Webhook重复重放不重复入账；年付定时补点有唯一周期键；生成失败仅退一次。真实浏览器完成上传→生成→编辑→MP4并检查文件，登录/支付测试模式，桌面/手机视觉检查、构建与单元测试、部署HTTPS和域名验证。
