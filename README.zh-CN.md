# Chat2Blend

> **让 ChatGPT 写一次，让 Blender 直接长出来。**

Chat2Blend（C2B）捕获 ChatGPT（或其他网页 LLM）正在输出的 Blender Python，并自动在已经打开的 Blender GUI 中执行它。不用复制粘贴，不用 OpenAI API Key，也不用让第二个 Coding Agent 再花 Token 写一遍建模代码。

```
用户
 ↓
ChatGPT 网页
 ↓
流式 Blender Python
 ↓
Chat2Blend 浏览器扩展
 ↓
本地 Bridge
 ↓
Blender 插件
 ↓
可见的 3D 模型
```

## 为什么存在

你已经为 ChatGPT/Claude/Gemini 付费。Coding Agent（Codex、Cursor 等）不应该再花 Token 重写同样的 `bpy` 代码。Chat2Blend 是一个**传输与执行层**，不是模型。它让你已有的 LLM 负责生成几何体，然后实时把几何体送进 Blender。

- **不需要 OpenAI API Key。** 使用用户已经登录的 ChatGPT 网页。
- **不浪费 Coding Agent Token。** Agent 只需说"用 Chat2Blend"。
- **流式执行。** 前面 chunk 已经在 Blender 里运行时，后面的 chunk 还在生成中。
- **本地优先。** 只监听 127.0.0.1，无隧道、无云端、无 SaaS。

## 状态

Windows：**已验证**（Blender 4.2.9，Chrome/Edge 扩展）
macOS：架构支持 / 实验性
Linux：架构支持 / 实验性

核心闭环真实跑通：`类 ChatGPT 流式 chunk → Bridge → Blender GUI → 3D 模型`。

## 快速开始

### 1. 环境要求

- Windows 10/11、macOS 或 Linux
- Node.js ≥ 20
- Blender 4.x
- Chrome 或 Edge

### 2. 安装

```bash
git clone https://github.com/nanhudev/chat2blend.git
cd chat2blend
npm install
npm run build
```

### 3. 安装 Blender 插件

```bash
npm run package:blender
```

打开 Blender → `编辑 > 偏好设置 > 插件 > 安装...` → 选择 `dist/chat2blend-blender.zip` → 启用 **Chat2Blend**。插件会自动连接本地 bridge。

### 4. 启动 Bridge

```bash
npm run c2b -- start
# 或构建后：
node dist/apps/bridge/src/cli.js start
```

这会启动仅监听 127.0.0.1 的 HTTP 服务（8787）和 TCP 传输（8788）。

### 5. 安装浏览器扩展

1. 打开 Chrome/Edge → `chrome://extensions`
2. 打开**开发者模式**
3. **加载已解压的扩展程序** → 选择 `apps/extension/dist`
4. 点击 Chat2Blend 图标，输入 `c2b pair` 显示的 6 位配对码
5. 打开 **Auto Execute**

### 6. 问 ChatGPT

点击扩展弹窗里的 **Copy Prompt**（或运行 `npm run c2b -- prompt "一个现代三人布艺沙发"`），把提示词贴到 ChatGPT，并确保助手按这种格式返回代码：

```python
# C2B:CHUNK setup
import bpy
...
# C2B:END

# C2B:CHUNK base
...
# C2B:END
```

然后看着 Blender 一边生成模型。

## CLI

```bash
npm run c2b -- <命令>
```

| 命令 | 作用 |
|------|------|
| `start` | 启动 bridge 守护进程 |
| `stop` | 停止 bridge |
| `status` | 查看 bridge / Blender / 扩展状态 |
| `doctor` | 完整诊断 |
| `pair` | 显示新的配对码 |
| `jobs` | 最近的任务 |
| `exec <file.py>` | 直接把 Python 文件送进 Blender |
| `prompt "任务"` | 打印 Chat2Blend 提示词模板 |

## 演示

一次真实 GUI 运行：启动 bridge、Blender 插件连接、`examples/cube.py` 被流式送进可见的 Blender 窗口。C2B_Cube 对象出现，全程无需复制粘贴。

![Chat2Blend 在 Blender GUI 中执行 Cube](docs/demo-cube.png)

## 架构

```
ChatGPT 网页
    ↓  DOM 流式抓取
浏览器扩展（捕获 + 去重 + 配对）
    ↓  localhost:8787 HTTP + token
本地 Bridge（任务、队列、认证、日志）
    ↓  localhost:8788 行分隔 JSON TCP
Blender 插件（主线程执行器、共享命名空间）
    ↓
Blender 场景
```

- **浏览器扩展**：Manifest V3 TypeScript，监控提供者 DOM，支持 ChatGPT，并提供**发送当前代码**的手动兜底。
- **Bridge**：零运行时依赖 Node.js，暴露 `/api/*` 路由，以及面向 Blender 的行分隔 JSON socket。
- **Blender 插件**：纯 Python stdlib + `bpy`。网络在后台线程运行；执行通过 `bpy.app.timers` 在主线程排空。

详见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

## C2B 协议（v1）

要让 LLM 支持流式执行，让它把代码包在：

```python
# C2B:CHUNK <name>
...python...
# C2B:END
```

规则：

- 使用 `bpy`、Blender 4.x API
- 先定义 helper，再使用
- 前面的 chunk 不能依赖后面的 chunk
- 每个 chunk 都是可独立执行的完整 Python 块

如果 LLM 不遵循协议，Chat2Blend 会在生成结束后回退为执行完整的 ` ```python ` 代码块。

详见 [`docs/PROTOCOL.md`](docs/PROTOCOL.md) 和 [`docs/STREAMING.md`](docs/STREAMING.md)。

## Agent 集成

Coding Agent 在 Chat2Blend 可用时不应该自己生成大段 `bpy`。应该：

```text
Use Chat2Blend to generate the Blender asset. First run `c2b status`; if Blender is not connected, tell the user to open Blender and enable the add-on. Then let the user ask ChatGPT from the browser extension.
```

参见 [`skill/SKILL.md`](skill/SKILL.md) 和 [`docs/AGENT_INTEGRATION.md`](docs/AGENT_INTEGRATION.md)。

## 安全

Chat2Blend 会执行 LLM 生成的 Python。这本身就是一把利剑。

- Bridge 仅绑定 **127.0.0.1**，不允许 `0.0.0.0`。
- 扩展必须先通过 6 位配对码配对，才能拿到 bridge token。
- 非 `chrome-extension://` / `http://127.0.0.1` / `http://localhost` 来源会被拒绝。
- 我们不索要 ChatGPT 账号、OpenAI API Key 或浏览器 Cookie。

详见 [`docs/SECURITY.md`](docs/SECURITY.md)。

## 开发

```bash
npm run build        # TypeScript + 扩展
npm run typecheck    # 仅 TypeScript
npm run test         # 解析器 + Bridge 集成测试
npm run build:extension
npm run package:blender
```

### 端到端验证

仓库包含真实 GUI E2E 测试：

```bash
node scripts/e2e-blender.mjs examples/sofa_chunks.py 1200
```

它会启动 bridge、打开 Blender GUI、连接插件、流式发送 C2B chunk，并验证场景中出现了模型。不需要真实 ChatGPT 会话。

## 路线图

- 多网页 LLM 适配器（Claude、Gemini、DeepSeek、Grok、本地 LLM）
- UI 中支持手动编辑 / 重试 / 跳过 chunk
- CI 用 headless 模式
- Godot 导出管线
- 团队 / 云端协作功能（不在核心中）

详见 [`docs/ROADMAP.md`](docs/ROADMAP.md)。

## License

MIT © Chat2Blend contributors
