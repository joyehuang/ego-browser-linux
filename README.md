# ego-browser-linux

[![CI](https://github.com/joyehuang/ego-browser-linux/actions/workflows/ci.yml/badge.svg)](https://github.com/joyehuang/ego-browser-linux/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js >= 22](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](package.json)

**English** | [简体中文](README.zh-CN.md)

A lightweight, self-hosted **Linux VPS edition of [`ego-browser`](https://github.com/citrolabs/ego-lite)** for AI coding agents (**Claude Code**, **Antigravity CLI**, **Pi**, **Codex**, and custom scripts).

Run real headed Google Chrome / Chromium on any Linux server (`Xvfb` + `openbox` + `x11vnc` + `noVNC`) with persistent logins, zero-login isolated E2E contexts, a unified **Web Console (`:6080`)**, cross-process multi-agent concurrency, and a first-class **Plugin & E2E Workflow System**.

[Quick Start](#quick-start) · [Web Console](#unified-web-console-6080) · [Deployment Guide](deploy/README.md) · [Extensibility & Plugins](docs/extensibility.md) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md)

---

## Architecture Layering

`ego-browser-linux` cleanly separates the upstream `ego-browser` SDK from the Linux host runtime so syncing upstream improvements stays straightforward:

```text
┌────────────────────────────────────────────────────────────────────────────┐
│  AI Agents & Developers (Claude Code / Antigravity / Pi / Codex / CI)      │
│    ├── ego-browser nodejs <<'EOF' ... EOF      (code-first browser scripts)│
│    ├── ego-browser plugins / run <plugin>.<wf> (reusable E2E workflows)    │
│    └── Browser Workstation ──> Web Console (:6080, SSH / Tailscale / HTTPS)│
└───────────────────────────────┬────────────────────────────┬───────────────┘
                                │                            │
┌───────────────────────────────▼────────────────────────────▼───────────────┐
│  Layer 1 — Upstream SDK (`package/ego-browser`, v2.2.1 + v2.3.0 sync)      │
│    TaskSpace & Page model · Snapshot refs (@N / loc=...) · Element resolver│
│    Site learnings (`skills/ego-browser/learnings/`) · Linux `xclip` paste  │
├────────────────────────────────────────────────────────────────────────────┤
│  Layer 2 — Linux Host Runtime (`package/ego-linux`)                        │
│    CDP shim & session router · File-locked `task-spaces.json` (Plan A)     │
│    Multi-profile BrowserContexts · Plugin & E2E Workflow loader            │
│    Unified Web Console (`ego-console`, :6080) ── proxies /vnc/* -> :6081   │
├────────────────────────────────────────────────────────────────────────────┤
│  Layer 3 — Headed Linux Browser Stack (systemd)                            │
│    Xvfb (:99) + Openbox + x11vnc (:5900) + websockify/noVNC (:6081)        │
│    google-chrome-stable (:19222) + persistent `--user-data-dir`            │
│    Optional SOCKS5 / HTTP proxy (`EGO_LINUX_PROXY`, residential/dual-ISP)  │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### Option A — AI-Native Install via Agent Skill *(Recommended)*

This repository includes an agent-ready installation playbook at [`skills/ego-browser-linux-install/SKILL.md`](skills/ego-browser-linux-install/SKILL.md). Point **Claude Code**, **Antigravity**, **Codex**, or **Pi** on your Linux server directly to it:

```text
Read https://raw.githubusercontent.com/joyehuang/ego-browser-linux/main/skills/ego-browser-linux-install/SKILL.md and install ego-browser-linux on this VPS for me.
```

Your agent will probe the environment, confirm your Console access mode (SSH tunnel / Tailscale / reverse proxy) and optional proxy settings, deploy the hardened `systemd` services, wire CLI & skills, and run the end-to-end smoke check.

### Option B — Manual Setup

#### 1. Install, Build & Verify Tests

```bash
cd package/ego-browser && CI=true npm ci
cd ../..

# Build SDK and run both SDK and headless Linux runtime test suites
npm test
npm run validate:site-skills
npm run style:check
```

#### 2. Install CLI & Agent Skills

```bash
mkdir -p ~/.local/bin ~/.agents/skills ~/.config/ego-browser/plugins
ln -sf "$PWD/package/ego-linux/bin/ego-browser.mjs" ~/.local/bin/ego-browser
cp -r package/ego-browser/dist/out/agent-skills/ego-browser ~/.agents/skills/ego-browser

# Optional: link for Claude Code, Pi, and Antigravity CLI
ln -sfn ../../.agents/skills/ego-browser ~/.claude/skills/ego-browser
ln -sfn ../../../.agents/skills/ego-browser ~/.pi/agent/skills/ego-browser
ln -sfn ../../../.agents/skills/ego-browser ~/.gemini/config/skills/ego-browser
```

#### 3. Deploy Systemd Services

See [deploy/README.md](deploy/README.md) for parameterized systemd templates (`ego-xvfb`, `ego-openbox`, `ego-x11vnc`, `ego-novnc`, `ego-chrome`, `ego-console`, and optional SOCKS5 proxy tunnel) and [SECURITY.md](SECURITY.md) for hardening guidance.

---

## Unified Web Console (`:6080`)

`ego-browser --console` (or `ego-console.service`) combines a live TaskSpace sidebar, browser navigation bar, per-tab management, and embedded noVNC on a single port:

- **Agent handoff deep-links**: When an agent hits login, 2FA, or a CAPTCHA, `await task.handOff()` pauses automation (`EGO_TASK_SPACE_USER_IN_CONTROL`), focuses the exact tab, and prints a clickable Console deep-link (`/?space=<id>`).
- **One-click auto-named spaces**: Create a new persistent or isolated space with a single click—spaces auto-name cleanly (`Space #N`, `Isolated #N`, `Seeded #N`) without interrupting you with a naming dialog.
- **Automatic closed-window recovery**: If you close the last Chrome window inside noVNC, `ego-chrome.service` recovers within ~1 second (`RestartSec=1`), `ego-console` reconnects over CDP automatically, and the Console displays a one-click **Reopen Chrome Window** recovery control (`POST /api/browser/reopen`).

### 3 Console Access Modes

| Mode | Configuration (`~/.config/ego-browser/env`) | How You Connect |
| --- | --- | --- |
| **1. SSH Tunnel *(default)*** | `EGO_CONSOLE_HOST=127.0.0.1`, `EGO_CONSOLE_PORT=6080` | `ssh -N -L 6080:127.0.0.1:6080 <vps-host>` → open `http://127.0.0.1:6080/` |
| **2. Tailscale / ZeroTier Direct** | `EGO_CONSOLE_HOST=<tailscale-ip>` + `EGO_CONSOLE_PUBLIC_URL=http://<tailscale-ip>:6080` *(or `tailscale serve --bg 6080` + `https://<node>.<tailnet>.ts.net`)* | Open the private-mesh URL directly (1-line env change + `systemctl restart ego-console`) |
| **3. Public Domain + Reverse Proxy** | Keep `EGO_CONSOLE_HOST=127.0.0.1`; set `EGO_CONSOLE_PUBLIC_URL=https://browser.example.com` + `EGO_CONSOLE_TOKEN=<secret>` | Front with Caddy, Nginx, or Cloudflare Tunnel (forwarding WebSockets & `X-Forwarded-Proto: https`) |

### Console Toolbar & Keyboard Shortcuts

The top bar provides **Back (`←`)**, **Forward (`→`)**, **Reload (`↻`)**, an editable **URL bar** (`Enter` to navigate, `Esc` to blur), **Copy URL** (with plain-HTTP fallback), **`+ Tab`**, per-tab **`×`** close buttons, a **Keys (`⌨`)** popover for one-click remote keys (`Ctrl+A`, `Ctrl+C`, `Ctrl+V`, `Ctrl+Z`, `Esc`), Live VNC / Grid Overview toggle, and the **Done — Return to Agent** handoff banner.

Shortcuts work seamlessly both on the Console chrome and while focused inside the embedded noVNC canvas:

| Action | Linux / Windows | macOS |
| --- | --- | --- |
| New tab in active Space | `Alt+T` | `Alt+T` |
| Close active tab | `Alt+W` | `Alt+W` |
| Reload active tab | `Alt+R` | `Alt+R` or `Cmd+R` |
| Focus & select URL bar | `Alt+L` | `Alt+L` or `Cmd+L` |
| Copy active tab URL | `Alt+C` | `Alt+C` |
| Navigate Back | `Alt+[` or `Alt+ArrowLeft` | `Alt+[` or `Cmd+[` |
| Navigate Forward | `Alt+]` or `Alt+ArrowRight` | `Alt+]` or `Cmd+]` |
| Switch to tab 1–9 | `Alt+1` … `Alt+9` | `Alt+1` … `Alt+9` |
| Toggle sidebar | `Alt+S` | `Alt+S` |
| Toggle Live / Grid view | `Alt+G` | `Alt+G` |

---

## Multi-Profile Isolation

`profiles()` / `ego.listProfiles()` exposes three built-in profiles:

| Profile ID | Behavior | Ideal Use Case |
| --- | --- | --- |
| `Default` *(default)* | Chrome native disk profile (`~/.local/share/ego-browser/profile`) | Persistent logged-in sessions across restarts (GitHub, SaaS, email) |
| `isolated` | Clean ephemeral `BrowserContext` (0 cookies, 0 logins, auto-disposed on close) | Clean E2E & visual noVNC tests without touching real accounts |
| `isolated-seeded` | Ephemeral `BrowserContext` seeded with a cookie snapshot of `Default` | Authenticated tests that must not mutate `Default` session state |

```js
// Reuse persistent logged-in sessions
const work = await taskSpace("github-triage");

// Clean 0-login isolated E2E space (watchable live in Console)
const e2e = await taskSpace("checkout-e2e", { profileId: "isolated" });
```

Add custom `isolated` / `isolated-seeded` profile presets in `~/.config/ego-browser/profiles.json` (see [deploy/profiles.json.example](deploy/profiles.json.example)).

---

## Multi-Agent Concurrency (Plan A)

Multiple AI agents and CLI runs safely share one headed Chrome instance:

- **Cross-process TaskSpace lock (`state-lock.mjs`)**: Atomic lockfile around `task-spaces.json` with dead-PID and stale-lock recovery.
- **Per-process space pinning**: Each CLI invocation pins its active `spaceId` so concurrent scripts cannot hijack each other's space.
- **Strict target & context scoping**: `tabs.mjs` isolates tabs by `BrowserContext` and tracked `targetIds` / `openerId`.
- **Serialized Linux clipboard**: `page.keyboard.paste()` acquires a cross-process lock around `xclip` so concurrent pastes never overwrite each other.

---

## Plugin & E2E Workflow System

Drop reusable helpers or automated E2E workflows into `~/.config/ego-browser/plugins/` (supports `*.mjs`/`*.js` and `<subdir>/index.mjs`), or load project-local plugins directly from any repo via `--plugin <path>`:

```bash
# List loaded plugins, helpers, and E2E workflows (offline)
ego-browser plugins --plugin examples/plugins/e2e-smoke-demo.mjs

# Run an isolated E2E workflow (logs live Console URL to stderr, JSON result to stdout)
ego-browser run smoke-demo.checkPage \
  --plugin examples/plugins/e2e-smoke-demo.mjs \
  --arg url=https://example.com \
  --arg expect="Example Domain"

# Keep the isolated space open to inspect results in the Web Console
ego-browser run smoke-demo.checkPage \
  --plugin examples/plugins/e2e-smoke-demo.mjs \
  --keep-open
```

See [examples/plugins/e2e-smoke-demo.mjs](examples/plugins/e2e-smoke-demo.mjs) and [docs/extensibility.md](docs/extensibility.md) for authoring helper and E2E workflow plugins.

---

## Optional SOCKS5 / HTTP Proxy (`EGO_LINUX_PROXY`)

Datacenter VPS IPs are frequently rate-limited or blocked by login walls and anti-bot checks. Set `EGO_LINUX_PROXY` (e.g. `socks5://127.0.0.1:10809` or `http://127.0.0.1:8080`) to route Chrome egress through a residential or dual-ISP proxy node:

- Pairs with `--host-resolver-rules="MAP * ~NOTFOUND , EXCLUDE 127.0.0.1"` so DNS resolves remotely through the proxy rather than leaking the VPS resolver.
- Pairs with `--force-webrtc-ip-handling-policy=disable_non_proxied_udp` to prevent WebRTC UDP IP leaks.
- See [deploy/README.md](deploy/README.md) for SSH SOCKS5 tunnel and optional `sing-box` traffic-accounting setup.

---

## Documentation

- [AI-Native Linux Install Skill](skills/ego-browser-linux-install/SKILL.md) — let your coding agent install and verify the full VPS stack
- [Deployment & Systemd Guide](deploy/README.md) — systemd unit templates, proxy options, and all 3 Console access modes
- [Extensibility & Plugin Guide](docs/extensibility.md) — helper plugins, E2E workflows, raw CDP, and site learnings
- [Security Policy & Threat Model](SECURITY.md) — loopback boundaries, Console hardening, and vulnerability reporting
- [Contributing Guide](CONTRIBUTING.md) — architecture boundaries, local dev commands, and PR checklist
- [Changelog](CHANGELOG.md) — release history

---

## Roadmap

- **Multi-persistent-profile `--user-data-dir` pool**: Manage multiple independent on-disk Chrome profiles (e.g. `work`, `personal`, `qa`) across dedicated CDP ports with unified Console switching.
- **Plan B — Full multi-Chrome / multi-Xvfb physical isolation**: Dedicated browser process + virtual display per agent/tenant for strict memory, GPU, and OS-level isolation at scale.

---

## Credits & License

- Released under the [MIT License](LICENSE).
- Built on upstream [`citrolabs/ego-lite`](https://github.com/citrolabs/ego-lite) (MIT) and upstream Linux Chrome host [PR #291](https://github.com/citrolabs/ego-lite/pull/291) (MIT).
- Includes 19 synced upstream `citrolabs/ego-lite` PRs (v2.3.0 zero-adopt `Page` tabs `#785`, task-space status lines `#790`, parallel `Page` loading `#793`, skill compaction reminder `#792`, `dev` fixes `#688`/`#726`/`#727`/`#734`/`#751`/`#770`, and iframe/OOPIF/scroll/drag reliability fixes `#807`–`#812`/`#747`/`#672`/`#240`/`#235`).
