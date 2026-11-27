# Changelog

All notable changes to `ego-browser-linux` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Page labels now survive separate `ego-browser nodejs` calls on Linux.** The SDK keyed its page ledger (`~/.ego-browser/state/space-<id>@<instance>.<seq>.json`) by the parent process id, which is stable under the Ego Lite app but new for every Linux CLI call. Each call therefore opened an empty ledger: `task.page("p1")` failed with `page label not found`, the tab was later re-adopted as `openedBy: "unknown"`, and `finish({ keep: [] })` left it open as a user page. `runtimeInstanceId()` now prefers `EGO_BROWSER_INSTANCE_ID`, and the Linux CLI sets it to `chrome-<browser target id>` from Chrome's `/devtools/browser/<id>` endpoint, which is fixed for the life of one Chrome process and changes when Chrome restarts. macOS/Windows behavior is unchanged.

## [0.1.0] - 2026-11-26

Initial open-source release of `ego-browser-linux`.

### Added

- **Linux Chrome CDP Host (`package/ego-linux`)**:
  - Full `ego-browser` v2.2.1 native binding contract over stock Google Chrome / Chromium CDP (`TaskSpace`, `Page`, `snapshot` with `@N` refs & stable `css:`/`href:`/`role:` locators, OOPIF frame tracking, `handOff`/`takeOver`, control gate enforcement).
  - External systemd Chrome discovery via `EGO_LINUX_CDP_URL` (supporting both `http://` and `ws://` endpoints) and automatic XDG env loading from `~/.config/ego-browser/env`.
  - Standalone CLI commands: `ego-browser nodejs`, `ego-browser skill`, `ego-browser plugins`, `ego-browser run`, `--console`, `--status`, `--stop`, `--open`, `--prune-spaces`.
- **Upstream `citrolabs/ego-lite` SDK Sync (19 PRs integrated into `package/ego-browser` & `skills/ego-browser/SKILL.md`)**:
  - **v2.3.0 capabilities**: every tab is directly a `Page` with the adopt step removed (`#785`), end-of-script task-space status line (`#790`), parallel `Page` loading inside a task space (`#793`), and skill re-run reminder after context compaction (`#792`).
  - **`dev` fixes**: temporary download cleanup on SDK exit (`#688`), iframe subtree snapshot `frameId` forwarding (`#726`), `Page.screencastFrameAck` frame number preservation (`#727`), `page.fill` retry for code editors (`#734`), releasing requests orphaned by replaced documents (`#751`), and keeping committed `Page` loads alive after command timeouts (`#770`).
  - **Reliability & Linux VM fixes**: programmatic scroll fallback and late wheel scroll wait (`#807`, `#811`), pruning superseded-document refs from the page ledger (`#808`), nested OOPIF frame-to-session mapping (`#809`), parent-document hit-testing before iframe clicks (`#812`), inner-layer hit detection inside buttons (`#747`), cross-process iframe file chooser observation (`#672`), `~` home expansion in `resolvePath` (`#240`), and drag-evidence peek before re-synthesizing drags (`#235`).
- **Unified TaskSpace + noVNC Web Console (`:6080`)**:
  - Single-port Console serving the TaskSpace sidebar, browser navigation toolbar (`←`/`→`/`↻`, editable URL bar, Copy URL with plain-HTTP fallback, `+ Tab`, per-tab `×` close, `⌨` remote keys popover), Live VNC / Grid Overview toggle, handoff banner, and proxied `/vnc/*` HTTP + WebSocket upstream (`:6081`).
  - Three network access modes: loopback SSH tunnel (default), Tailscale / ZeroTier direct bind or `tailscale serve` HTTPS, and public reverse proxy (Caddy / Nginx / Cloudflare Tunnel) with `EGO_CONSOLE_TOKEN` auth and `X-Forwarded-Proto: https` Secure cookie handling.
  - VNC-penetrating keyboard shortcuts (`Alt+T`, `Alt+W`, `Alt+R`, `Alt+L`, `Alt+C`, `Alt+[`/`]`, `Alt+ArrowLeft`/`ArrowRight`, `Alt+1`–`9`, plus macOS `Cmd+R/L/[/]`) attached to both Console chrome and the same-origin noVNC frame.
  - Frictionless one-click space creation with automatic naming (`Space #N`, `Isolated #N`, `Seeded #N`).
  - Automatic closed-window recovery: `POST /api/browser/reopen`, resilient CDP reconnect in `ego-console`, and fast Chrome service restart (`RestartSec=1`).
- **Multi-Profile Isolation**:
  - Built-in profiles via `profiles()` / `taskSpace(name, { profileId })`: persistent `Default`, zero-login ephemeral `isolated`, and cookie-seeded ephemeral `isolated-seeded`.
  - Custom `isolated` / `isolated-seeded` profile presets via `~/.config/ego-browser/profiles.json` (`deploy/profiles.json.example`).
- **Multi-Agent Concurrency (Plan A)**:
  - Atomic cross-process file locking (`state-lock.mjs`) around `task-spaces.json` with dead-PID and stale-lock recovery.
  - Per-process space pinning, strict `BrowserContext` / target scoping, and serialized Linux `xclip` clipboard transactions (`package/ego-browser/src/clipboard.ts`).
- **Plugin & E2E Workflow Engine**:
  - Discovery across `~/.config/ego-browser/plugins/`, `~/.config/ego-browser/extensions/`, `EGO_BROWSER_PLUGINS`, and repeatable CLI `--plugin <path>`.
  - `ego-browser plugins` inspection and `ego-browser run <plugin>.<workflow>` structured JSON runner with `ctx.withSpace` defaulting to `isolated` contexts and live Console URL logging.
  - Runnable example workflow in `examples/plugins/e2e-smoke-demo.mjs` and authoring guide in `docs/extensibility.md`.
- **Deployment & Proxy Templates (`deploy/`)**:
  - Parameterized systemd templates (`ego-xvfb`, `ego-openbox`, `ego-x11vnc`, `ego-novnc`, `ego-chrome`, `ego-console`, and optional `socks-tunnel`), `deploy/env.example`, and optional `sing-box` loopback SOCKS inbound template for traffic accounting.
- **Open-Source Governance & CI**:
  - GitHub Actions CI (`.github/workflows/ci.yml`) running SDK tests, site-skill validation, Prettier checks, and headless Chrome runtime tests on Node 22.
  - `CONTRIBUTING.md`, `SECURITY.md`, issue forms, PR template, and root convenience `package.json` scripts.

[Unreleased]: https://github.com/joyehuang/ego-browser-linux/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/joyehuang/ego-browser-linux/releases/tag/v0.1.0
