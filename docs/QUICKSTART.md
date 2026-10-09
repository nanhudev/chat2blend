# Chat2Blend · 三分钟上手

## 下载安装

从 [GitHub Release](https://github.com/nanhudev/chat2blend/releases/tag/desktop-v0.4.2) 下载：

| 你的设备 | 下载文件 |
|---|---|
| Windows 64 位 | `chat2blend-0.4.2-Setup-x64.exe` |
| Windows 免安装体验 | `chat2blend-0.4.2-Portable-x64.exe` |
| Apple Silicon Mac | `chat2blend-0.4.2-mac-arm64.dmg` |
| Linux x64 通用便携版 | `chat2blend-0.4.2-linux-x64.AppImage` |
| Debian / Ubuntu x64 | `chat2blend-0.4.2-linux-amd64.deb` |

Windows 安装版支持选择目录；便携版直接双击启动。Mac 打开 DMG，将应用拖到 Applications。目前没有 Intel Mac 安装包。桌面安装包包含运行环境，不需要为了打开界面安装 Node。

## 第一次操作

安装 Blender 后，在应用选择 Blender 程序和保存文件夹，点击固定配方生成。此流程无需 AI 登录，会打开可见的 Blender。

选择 Blender → 选择保存位置 → 设置机器人配色和尺寸 → 生成资产 → 查看质量检查 → 在 Blender 编辑 → 导出并复核 .blend / GLB。官方账户授权后可用自然语言配置配色和比例。

## 登录与数据

点击“使用 ChatGPT 登录”，在系统浏览器的 OpenAI 官方页面本人完成授权，返回应用选择可用模型。应用不索取其他产品的登录文件；本机登录凭据使用系统加密保存。账号资格、模型权限与额度以官方页面和实际请求为准。

真实 AI 生成会将任务和你提交的原文发送给模型服务；不要输入没有授权处理的内容。固定示例不会请求模型。退出登录会清理授权 Token，保留本应用的客户端注册与账户标识供再次登录。

## 常见问题

| 情况 | 如何处理 |
|---|---|
| 尚未登录，生成按钮提示授权 | 完成官方登录，或先查看固定示例 |
| 授权拒绝、账户无资格或额度不足 | 阅读返回的实际错误；成功打开浏览器或取得模型列表不代表推理已成功 |
| Windows / macOS 提示来源无法验证 | 当前预览包未签名或公证；校验 Release 的 SHA256SUMS，使用你信任的来源 |
| 模型输出被校验拒绝 | 检查输入和错误说明后调整任务；应用不会把不完整输出标成成功 |
| 需要报告问题 | 提交系统、版本、操作步骤、错误文字；不要附账户 Token 或教材隐私内容 |

Blender 未找到时，在界面选择已安装的 Blender 程序；Mac 可选择 Blender.app。当前完整资产配方是机械机器人，不能把任意人物提示词视为已支持能力。

[更详细的构建与授权说明](DESKTOP.md)


## Linux 使用

Debian / Ubuntu 推荐 deb：使用系统软件安装器打开，安装后从应用菜单启动。AppImage 用于其他 Linux 桌面发行版，在文件属性中允许作为程序执行后双击打开。AppImage 需要系统提供 FUSE 运行支持；若 Debian / Ubuntu 的系统缺少它，可优先使用 deb。

当前提供 Linux x64。Linux 自动化验收在 Ubuntu 22.04 的虚拟显示器上打开实际应用窗口，检查已安装 deb 和解包 AppImage；不等同于使用者设备实测。官方登录需要可用的 GNOME Keyring 或 KWallet；系统凭据加密不可用时会明确拒绝保存登录凭据。
