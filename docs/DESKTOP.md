# Chat2Blend 桌面版

Windows 安装包：`desktop/dist/*-Setup-x64.exe`。便携包：`desktop/dist/*-Portable-x64.exe`。构建输出不进入 Git；[公开安装包](https://github.com/nanhudev/chat2blend/releases/tag/desktop-v0.4.2)提供 Windows x64 和 Apple Silicon Mac 预览版本，附 SHA256SUMS。[三分钟上手](QUICKSTART.md)适用于非开发者。

1. 打开应用，先看固定示例了解操作。
2. 在“账户与保存位置”使用 ChatGPT 登录，在 OpenAI 官方页面完成授权。
3. 选择账户返回的模型、输入任务，再生成方案。
4. 审阅方案，执行或导出成果。

需要已安装 Blender；可在界面选择程序。固定资产配方不需要登录。

登录采用官方开源本地应用 Sign in with ChatGPT：系统浏览器、回环回调、PKCE、state、nonce、签名校验与系统加密凭据。模型列表不等于请求成功；实际生成完成才代表该账户下推理可用。应用不读取其他产品的登录凭据。

官方参考：[本地应用授权](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)、[模型与推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)。账户资格和套餐额度以官方授权与实际请求为准。

开发启动（Node 22.12+）：在 `desktop` 内运行 `npm ci`，再 `npm start`。Agent2LLM 还需在仓库根目录先 `npm ci`。Windows 构建运行 `npm run package:win`；Mac 原生环境运行 `npm run package`，产生当前机器架构的 DMG。

验证：`npm test` 检查授权回调、流式响应、输出结构；`npm run test:ui` 打开真实桌面窗口检查基本操作。Chat2Blend 设置 `DESKTOP_ASSET_TEST=1` 时，还会打开真实 Blender 生成资产。

当前安装包没有商业代码签名与 Apple 公证。构建成功、安装器启动、账户授权、真实生成和实际用户验收是不同验证环节。没有完成的环节不要标为通过。

Linux 原生构建：在 Linux 的 desktop 目录运行 `npm run package:linux`，生成 x64 AppImage 和 amd64 deb。CI 在 Ubuntu 22.04 上通过虚拟显示器检查窗口，并检查安装后的 deb 和解包后的 AppImage。发布前须确认对应构建和检查已通过。
