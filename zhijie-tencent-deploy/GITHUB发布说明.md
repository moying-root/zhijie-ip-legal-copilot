# 将知界分享给任何拿到链接的人

## 当前能公开分享什么

GitHub Pages 可分享三个页面、浏览器规则审查、立场与场景切换、规则管理、报告导出。合同在访问者的浏览器中处理，不上传 GitHub。AI 审查和连续追问仍需独立后端及服务端模型密钥；Pages 不能运行本项目 Node.js 服务，不会自动获得这些功能。

## 创建仓库（仅第一次）

1. 登录 GitHub，打开 https://github.com/new?name=zhijie-ip-legal-copilot&visibility=public
2. 名称为 `zhijie-ip-legal-copilot`，选择 `Public`（公开）。
3. 点击底部绿色 `Create repository`（创建仓库）。空仓库即可，不需要先上传任何文件。
4. 将仓库链接发给助手，由助手完成代码上传。

## 开启网页发布

代码上传后，仓库中打开 `Settings`（设置）→ 左侧 `Pages`。

- 如果已上传 `.github/workflows/pages.yml`：将 `Build and deployment` 下的 `Source` 选择为 `GitHub Actions`。然后在 `Actions` 中运行 `Publish Zhijie Demo`；若推送时已完成配置，则会自动运行。绿色完成后，Pages 页面显示真实发布地址。
- 如果连接没有 Actions 工作流写入权限：助手可将静态文件同步到 `docs/`。此时 `Source` 选择 `Deploy from a branch`，`Branch` 选择 `main`，目录选择 `/docs`，点击 `Save`。不要选择根目录，因为入口文件实际在 docs 或 dist 中。

未看到部署成功前，不要把推测的网址当作已上线链接。

## 公开范围

选择 Public 会公开代码。发布文件仅包含静态资源；后端密钥不得放进 dist、docs、README 或仓库。示例 `.env.example` 不含真实密钥，真实 `.env` 已忽略。

## 后续开放 AI

需要另外部署 Node.js 后端，并配置独立访客会话、HTTPS、用量限制及模型密钥。当前后端限制为本机访问，不能直接搬到公网运行。现阶段 GitHub Pages 是公开规则演示版，AI 按钮会明确显示未连接，避免误导访问者。
