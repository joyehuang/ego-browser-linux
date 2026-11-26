# ego-browser-linux

[![CI](https://github.com/joyehuang/ego-browser-linux/actions/workflows/ci.yml/badge.svg)](https://github.com/joyehuang/ego-browser-linux/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js >= 22](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](package.json)

[English](README.md) | **简体中文**

一个轻量、可自托管的 **[`ego-browser`](https://github.com/citrolabs/ego-lite) Linux VPS 版本**，专为 **Claude Code**、**Antigravity CLI**、**Pi**、**Codex** 等 AI Coding Agent 与自动化脚本打造。

在任意 Linux 服务器上运行真实有头 Google Chrome / Chromium（`Xvfb` + `openbox` + `x11vnc` + `noVNC`），兼顾 **持久化登录态**、**零登录隔离 E2E 上下文**、**统一 Web 控制台（`:6080`）**、**跨进程多 Agent 并发安全**，以及一等公民级别的 **插件与 E2E Workflow 引擎**。

[快速开始](#快速开始) · [统一 Web 控制台](#统一-web-控制台-6080) · [多 Profile 隔离](#多-profile-隔离) · [插件与 E2E 工作流](#插件与-e2e-workflow-引擎) · [部署指南](deploy/README.md) · [扩展开发文档](docs/extensibility.md) · [安全说明](SECURITY.md)

---

## 架构分层

`ego-browser-linux` 将上游 `ego-browser` SDK 与 Linux 宿主运行时清晰解耦，既便于持续同步上游改进，又能自由扩展 Linux 独占能力：

```text
┌────────────────────────────────────────────────────────────────────────────┐
│  AI Agents 与开发者 (Claude Code / Antigravity / Pi / Codex / CI)          │
│    ├── ego-browser nodejs <<'EOF' ... EOF      (代码优先浏览器自动化脚本)  │
│    ├── ego-browser plugins / run <plugin>.<wf> (可复用 E2E 测试工作流)     │
│    └── 浏览器工作台 ──> Web Console (:6080, SSH 隧道 / Tailscale / HTTPS)  │
└───────────────────────────────┬────────────────────────────┬───────────────┘
                                │                            │
┌───────────────────────────────▼────────────────────────────▼───────────────┐
│  Layer 1 — 上游 SDK (`package/ego-browser`, v2.2.1 + v2.3.0 同步)          │
│    TaskSpace & Page 模型 · 快照索引 (@N / loc=...) · 元素定位器            │
│    站点经验包 (`skills/ego-browser/learnings/`) · Linux `xclip` 锁粘贴     │
├────────────────────────────────────────────────────────────────────────────┤
│  Layer 2 — Linux 宿主运行时 (`package/ego-linux`)                          │
│    CDP shim 与会话路由 · 加文件锁的 `task-spaces.json` (方案 A 并发)       │
│    多 Profile BrowserContext · 插件与 E2E Workflow 加载器                  │
│    统一 Web 控制台 (`ego-console`, :6080) ── 反代 /vnc/* -> :6081          │
├────────────────────────────────────────────────────────────────────────────┤
│  Layer 3 — 有头 Linux 浏览器底座 (systemd)                                 │
│    Xvfb (:99) + Openbox + x11vnc (:5900) + websockify/noVNC (:6081)        │
│    google-chrome-stable (:19222) + 持久化 `--user-data-dir`              │
│    可选 SOCKS5 / HTTP 出口代理 (`EGO_LINUX_PROXY`，防机房 IP 封控)         │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 快速开始

### 方式一：AI-Native Skill 一键让 Agent 自动安装 *（推荐）*

仓库内置了一套专门给 Agent 读取执行的 Linux 安装 Skill：[`skills/ego-browser-linux-install/SKILL.md`](skills/ego-browser-linux-install/SKILL.md)。直接把下面这句话发给服务器上的 **Claude Code**、**Antigravity**、**Codex** 或 **Pi**：

```text
请阅读 https://raw.githubusercontent.com/joyehuang/ego-browser-linux/main/skills/ego-browser-linux-install/SKILL.md 并帮我在这台 Linux VPS 上安装并验证 ego-browser-linux。
```

Agent 会自动完成：环境预检 → 询问你的 Console 转发模式 / 代理 / Agent 偏好 → 安装 Chrome 与 Xvfb/noVNC 依赖 → 构建并软链 CLI/Skill → 部署加固的 `systemd` 服务 → 执行全链路 E2E 冒烟验收。

---

### 方式二：手动安装部署

#### 1. 安装依赖、构建并运行全量测试

```bash
cd package/ego-browser && CI=true npm ci
cd ../..

# 构建 SDK 并运行 SDK 与无头 Linux 运行时全部单测
npm test
npm run validate:site-skills
npm run style:check
```

#### 2. 安装 CLI 与 Agent Skills

```bash
mkdir -p ~/.local/bin ~/.agents/skills ~/.config/ego-browser/plugins
ln -sf "$PWD/package/ego-linux/bin/ego-browser.mjs" ~/.local/bin/ego-browser
cp -r package/ego-browser/dist/out/agent-skills/ego-browser ~/.agents/skills/ego-browser

# 按需链接到 Claude Code、Pi、Antigravity CLI、Codex
ln -sfn ../../.agents/skills/ego-browser ~/.claude/skills/ego-browser
ln -sfn ../../../.agents/skills/ego-browser ~/.pi/agent/skills/ego-browser
ln -sfn ../../../.agents/skills/ego-browser ~/.gemini/config/skills/ego-browser
```

#### 3. 部署 Systemd 常驻服务

完整参数化模板（`ego-xvfb`、`ego-openbox`、`ego-x11vnc`、`ego-novnc`、`ego-chrome`、`ego-console` 及可选 SOCKS5 代理隧道）请查看 [deploy/README.md](deploy/README.md)，安全边界请查看 [SECURITY.md](SECURITY.md)。

---

## 统一 Web 控制台 (`:6080`)

`ego-browser --console`（或 `ego-console.service`）把 TaskSpace 侧边栏、浏览器导航栏、多标签管理与内嵌 `noVNC` 画面合二为一：

- **Agent 人工接管直达深链**：当 Agent 遇到登录、2FA 或验证码时，调用 `await task.handOff()` 会暂停自动化（`EGO_TASK_SPACE_USER_IN_CONTROL`）、聚焦到对应标签页，并直接给出可点击的控制台链接（`/?space=<id>`）。
- **一键创建、无需强制命名**：点击 `+ New Space` 或 `+ Isolated` 即可直接新建并聚焦窗口，留空自动命名为 `Space #N` / `Isolated #N` / `Seeded #N`；需要自定义名字与 Profile 时点 `⋯` 展开。
- **关闭窗口自动恢复**：即使你在 noVNC 里把所有 Chrome 窗口都关掉了，`ego-chrome.service` 会在约 1 秒内恢复（`RestartSec=1`），`ego-console` 会自动重连 CDP，Console 画面还会提供一键 **Reopen Chrome Window** 恢复按钮（`POST /api/browser/reopen`）。

### 3 种控制台访问模式（按需切换）

| 模式 | 配置（`~/.config/ego-browser/env`） | 打开方式 |
| --- | --- | --- |
| **1. SSH 隧道 *（默认推荐）*** | `EGO_CONSOLE_HOST=127.0.0.1`, `EGO_CONSOLE_PORT=6080` | 本机执行 `ssh -N -L 6080:127.0.0.1:6080 <vps-host>` → 打开 `http://127.0.0.1:6080/` |
| **2. Tailscale / ZeroTier 内网直连** | `EGO_CONSOLE_HOST=<tailscale-ip>` + `EGO_CONSOLE_PUBLIC_URL=http://<tailscale-ip>:6080` *（或配合 `tailscale serve`）* | 直接点开内网 URL，Agent 传来的 Handoff 链接也能一键打开 |
| **3. 公网域名 + 反向代理** | 保持 `EGO_CONSOLE_HOST=127.0.0.1`；设置 `EGO_CONSOLE_PUBLIC_URL=https://browser.example.com` + `EGO_CONSOLE_TOKEN=<secret>` | 前置 Caddy / Nginx / Cloudflare Tunnel（透传 WebSocket 与 `X-Forwarded-Proto: https`） |

### 工具栏与穿透 noVNC 快捷键

顶部提供 **后退 (`←`)**、**前进 (`→`)**、**刷新 (`↻`)**、可编辑 **地址栏**（回车跳转、`Esc` 失焦）、内嵌 **Copy URL**（支持纯 HTTP 内网兜底）、**`+ Tab`**、标签页独立 **`×`** 关闭、两步确认关闭 Space、**远端按键面板 (`Ctrl+A/C/V/Z` / `Esc`)**、**Live VNC ↔ Grid 缩略图总览** 切换，以及接管时的 **Done — Return to Agent** 横幅。

即使键盘焦点在右侧 `noVNC` 远端画面里，下面快捷键依然直接生效：

| 操作 | Linux / Windows | macOS |
| --- | --- | --- |
| 当前 Space 新开标签 | `Alt+T` | `Alt+T` |
| 关闭当前标签 | `Alt+W` | `Alt+W` |
| 刷新当前标签 | `Alt+R` | `Alt+R` 或 `Cmd+R` |
| 聚焦并全选地址栏 | `Alt+L` | `Alt+L` 或 `Cmd+L` |
| 复制当前页面 URL | `Alt+C` | `Alt+C` |
| 后退 | `Alt+[` 或 `Alt+ArrowLeft` | `Alt+[` 或 `Cmd+[` |
| 前进 | `Alt+]` 或 `Alt+ArrowRight` | `Alt+]` 或 `Cmd+]` |
| 切换到第 1–9 个标签 | `Alt+1` … `Alt+9` | `Alt+1` … `Alt+9` |
| 折叠 / 展开侧边栏 | `Alt+S` | `Alt+S` |
| 切换 Live VNC / Grid 总览 | `Alt+G` | `Alt+G` |

---

## 多 Profile 隔离

通过 `profiles()` / `ego.listProfiles()` 可使用三种内置隔离级别：

| Profile ID | 行为说明 | 适用场景 |
| --- | --- | --- |
| `Default` *（默认）* | 持久化磁盘 Chrome Profile（`~/.local/share/ego-browser/profile`） | 保留 GitHub、Google、SaaS 等日常长期登录态 |
| `isolated` | 纯净临时 `BrowserContext`（0 Cookie、0 登录态、关闭即销毁） | 纯净 E2E 测试、VNC 实时看效果，完全不碰个人账号 |
| `isolated-seeded` | 临时拷贝一份 `Default` Cookie 快照启动隔离上下文 | 需要已登录态跑测试，但测试期间修改不污染主 Profile |

```js
// 复用持久化登录态
const work = await taskSpace("github-triage");

// 打开零登录纯净隔离 E2E Space（可在 Web Console 实时观看）
const e2e = await taskSpace("checkout-e2e", { profileId: "isolated" });
```

还可以在 `~/.config/ego-browser/profiles.json` 中增加自定义 `isolated` / `isolated-seeded` 预设（参考 [deploy/profiles.json.example](deploy/profiles.json.example)）。

---

## 多 Agent 并发安全（方案 A）

多个 AI Agent 与 CLI 进程可以安全共用同一个有头 Chrome 实例：

- **跨进程 TaskSpace 文件锁（`state-lock.mjs`）**：对 `task-spaces.json` 的读写使用原子锁文件，支持死 PID 与超时陈旧锁自动清理。
- **进程级 Space Pin 绑定**：每个 CLI 进程记录自己选中的 `spaceId`，并发 Agent 不会互相抢占焦点。
- **严格的 Target 与 Context 隔离**：`tabs.mjs` 按 `BrowserContext`、`targetIds` 与 `openerId` 严格隔离可见标签页。
- **Linux 剪贴板跨进程串行化**：`page.keyboard.paste()` 对 `xclip` 操作加跨进程互斥锁，避免并发粘贴串台。

---

## 插件与 E2E Workflow 引擎

可以把常用自定义 helper 或完整 E2E 流程放到 `~/.config/ego-browser/plugins/`（支持单文件 `*.mjs`/`*.js` 或 `<目录>/index.mjs`），也可以在业务仓库中直接通过 `--plugin <路径>` 加载执行：

```bash
# 查看已发现插件及其导出的 helpers / E2E workflows（离线）
ego-browser plugins --plugin examples/plugins/e2e-smoke-demo.mjs

# 运行一条隔离的 E2E workflow（stderr 输出实时 Console 链接，stdout 输出结构化 JSON）
ego-browser run smoke-demo.checkPage \
  --plugin examples/plugins/e2e-smoke-demo.mjs \
  --arg url=https://example.com \
  --arg expect="Example Domain"

# 保留运行后的隔离 Space，方便去 Web Console 里通过 noVNC 回看现场
ego-browser run smoke-demo.checkPage \
  --plugin examples/plugins/e2e-smoke-demo.mjs \
  --keep-open
```

示例插件与完整开发文档请参考 [examples/plugins/e2e-smoke-demo.mjs](examples/plugins/e2e-smoke-demo.mjs) 和 [docs/extensibility.md](docs/extensibility.md)。

---

## 可选 SOCKS5 / HTTP 代理（防机房 IP 封控）

云服务器机房 IP 很容易在登录或验证阶段被目标站点风控拦截。在 `~/.config/ego-browser/env` 中设置 `EGO_LINUX_PROXY`（例如 `socks5://127.0.0.1:10809` 或 `http://127.0.0.1:8080`）即可让 Chrome 流量走住宅 / 双 ISP 出口代理：

- 配合 `--host-resolver-rules="MAP * ~NOTFOUND , EXCLUDE 127.0.0.1"` 防止 VPS 本地 DNS 泄露；
- 配合 `--force-webrtc-ip-handling-policy=disable_non_proxied_udp` 防止 WebRTC UDP 泄露真实机房 IP；
- SSH 代理隧道与可选 `sing-box` 流量统计配置模板见 [deploy/README.md](deploy/README.md)。

---

## 文档索引

- [AI-Native Linux 安装 Skill](skills/ego-browser-linux-install/SKILL.md) — 让你的 AI Agent 自动在 VPS 上安装部署并完成验收
- [部署与 Systemd 指南](deploy/README.md) — 服务模板、3 种 Console 访问模式与出口代理配置
- [扩展与插件开发指南](docs/extensibility.md) — 如何编写 helper 插件、E2E workflow、调用底层 CDP 与站点头脑包
- [安全策略与威胁模型](SECURITY.md) — 回环绑定边界、Console 鉴权与漏洞反馈方式
- [贡献指南](CONTRIBUTING.md) — 仓库分层约定、本地测试与 PR 检查清单
- [更新日志](CHANGELOG.md) — 版本发布记录

---

## Roadmap

- **多持久化 `--user-data-dir` Profile 池**：为不同持久化身份（如 `work`、`personal`、`qa`）调度独立 Chrome 实例与 CDP 端口，并在统一 Console 中切换管理。
- **方案 B — 全物理隔离多 Chrome / 多 Xvfb 实例**：按 Agent 或租户分配独立浏览器进程与虚拟显示器，提供更高强度的内存、窗口与系统级隔离。

---

## 致谢与协议

- 本项目基于 [MIT License](LICENSE) 开源。
- 基于上游 [`citrolabs/ego-lite`](https://github.com/citrolabs/ego-lite)（MIT）与上游 Linux Chrome 宿主方案 [PR #291](https://github.com/citrolabs/ego-lite/pull/291)（MIT）演进。
- 已同步整合上游 19 个高价值 PR（涵盖 v2.3.0 免 adopt `Page` 模型 `#785`、状态行 `#790`、并行 Page 加载 `#793`、Skill 重读提示 `#792`、`dev` 修复 `#688`/`#726`/`#727`/`#734`/`#751`/`#770`，以及 iframe/OOPIF/滚动/拖拽可靠性修复 `#807`–`#812`/`#747`/`#672`/`#240`/`#235`）。
