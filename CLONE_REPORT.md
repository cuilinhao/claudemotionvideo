# Claude Motion Video 交付记录

日期：2026-10-18。参考站 Tellcut，采用用户指定的 [web-clone skill](https://github.com/cuilinhao/claude-skill-web-clone)；前后端为独立实现。

## 已上线

- 应用：https://claudemotionvideo.com
- www 保留路径和查询参数跳转根域。
- Cloudflare Workers + D1 + 私有 R2 + Workflows + Email Sending；Namecheap nameservers 已切至 Cloudflare，区域状态 active。
- 代码：React、TypeScript、Vite、Hono；APIMart 的原生 Claude Messages 接口生成 Canvas 动画，浏览器通过 WebCodecs/Mediabunny 导出静音 H.264 MP4。

## 实际验收

| 项目 | 结果 |
|---|---|
| 首页 | 1512px 桌面与390×844手机截图；手机无横向溢出；展示本站真实图片→视频示例 |
| 线上上传/生成 | PNG 经认证API存入私有R2，Workflow调用APIMart，生成4分镜10秒动画并保存项目版本 |
| 预览/导出 | 真实Chrome播放、选分镜、浏览器编码并上传成片；ffprobe验证1920×1080、30fps、10秒、H.264、3,137,087 bytes |
| 私有成片 | 登录访问200，匿名访问401 |
| 失败退款 | 一次上游请求失败后140积分全额返还；随后新请求成功 |
| 编辑 | 浏览器选择最后分镜并改标题，自动完成V2，保留V1；余额160→120，预估和实际均40积分 |
| Stripe测试 | 真实测试API创建Checkout、绑测试卡、三天试用300积分、19.90USD模拟付款后1800积分、重复事件不重复发点、Portal可用；测试订阅已取消，无实际扣款 |
| 代码检查 | TypeScript、73项单元/集成测试、Vite生产构建通过；生产依赖审计0漏洞 |
| 密钥 | APIMart存于Worker secret；本地secret文件忽略；仓库候选文件扫描未发现真实凭证 |

截图位于 `RECON/screenshots/live-home-desktop.jpg`、`live-home-mobile.jpg` 和 `live-studio-preview.jpg`。私有控制台及验收成片放在被Git忽略的 `RECON/private/`。

## 正式收款

账户持有人已完成Stripe正式激活与通行密钥身份验证。本站8项权限受限密钥、6个正式Price、固定Portal配置和版本为 `2026-09-30.endive` 的Webhook已安装到Cloudflare encrypted secrets。

正式Checkout已验证Starter三天绑卡试用、之后19.90USD/月；年付166.80USD无试用；六个价格的USD金额、周期及live模式逐个核对。Portal允许更新付款方式和期末取消，关闭套餐切换。签名健康事件返回200、错误签名400，确认公开Webhook路由与线上签名配置一致。验收Checkout均已过期，未提交真实银行卡、未创建正式订阅、未扣款；真实付款后的Stripe事件投递与银行提现未作生产验收。

结账页面截图：`RECON/screenshots/live-stripe-checkout.jpg`。

## 已知范围

- 没有自动主体分割、真实多层蒙版、配音和背景音乐。
- 退款或拒付后的积分调整由运营人工处理。
- 导出依赖支持WebCodecs H.264的浏览器；完整设备矩阵和各分辨率/比例性能未覆盖。
- Cloudflare发信域名及binding已配置，密码重置令牌过期/一次性与会话失效有自动测试；未向真实收件箱发送验收邮件。
- Chrome扩展未开放本地file URL权限，因此本轮图片选择器未完成自动化验收；图片上传API、保存后图片恢复与预览已实测。
- 未获得原站完整源码；页面风格和主要使用流程相似，原站客户案例未复制；模板卡为提示预设，不代表每个卡片都有独立生成样片。

后续运行、部署和Stripe配置见 `README.md`，实现审计见 `CLONE_AUDIT.md`。
