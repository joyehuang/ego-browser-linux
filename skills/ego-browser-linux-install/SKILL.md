---
name: ego-browser-linux-install
description: Install, configure, and verify ego-browser-linux on a Linux VPS or workstation (headed Chrome/Chromium over Xvfb + Openbox + x11vnc + noVNC, Unified Web Console on :6080, multi-profile isolation, optional residential/SOCKS5 proxy, and AI agent CLI/skills wiring). Use when the user asks to install, deploy, or set up ego-browser on Linux.
metadata:
  version: "0.1.0"
---

# Install `ego-browser-linux` on a Linux Host

Use this Skill when setting up `ego-browser-linux` for a user on a headless Linux VPS or Linux desktop. Follow phases **0 → 6** in order and verify every acceptance check before finishing.

## Phase 0: Preflight Probe (Read-Only)

Gather system facts before changing anything:

```bash
id
uname -a
cat /etc/os-release | head -n 6
command -v node && node -v || echo "node:missing"
command -v npm || echo "npm:missing"
command -v git || echo "git:missing"
command -v google-chrome-stable google-chrome chromium chromium-browser || echo "chrome:missing"
for bin in Xvfb openbox x11vnc websockify xclip; do
  command -v "$bin" && echo "$bin:ok" || echo "$bin:missing"
done
ss -tlnp 2>/dev/null | grep -E ':(5900|6080|6081|19222)\b' || echo "ports:free"
```

## Phase 1: Confirm 4 User Preferences

Ask the user one concise message covering these 4 choices (skip any the user already specified):

1. **Target Linux user & install path** — default: current non-root user (or dedicated user) and `~/dev/ego-browser-linux`.
2. **Web Console (`:6080`) access mode**:
   - **Mode 1 — SSH Tunnel *(recommended default)***: bind `127.0.0.1:6080`; user runs `ssh -N -L 6080:127.0.0.1:6080 <vps-host>`.
   - **Mode 2 — Tailscale / ZeroTier Direct**: bind `EGO_CONSOLE_HOST=<tailscale-ip>` + set `EGO_CONSOLE_PUBLIC_URL=http://<tailscale-ip>:6080` (or `https://<node>.<tailnet>.ts.net` via `tailscale serve`).
   - **Mode 3 — Public Domain + Reverse Proxy / Cloudflare Tunnel**: bind `127.0.0.1:6080`, set `EGO_CONSOLE_PUBLIC_URL=https://browser.example.com` + random `EGO_CONSOLE_TOKEN`.
3. **Optional egress proxy & timezone**:
   - Whether to route Chrome through a residential/dual-ISP SOCKS5 or HTTP proxy (`EGO_LINUX_PROXY=socks5://127.0.0.1:<port>` or `http://...`) to avoid datacenter IP blocks.
   - Browser timezone (`TZ`, e.g. `America/Los_Angeles`, `UTC`, `Asia/Shanghai`).
4. **AI coding agents to wire** — shared `~/.agents/skills/ego-browser` plus optional symlinks for Claude Code (`~/.claude/skills`), Pi (`~/.pi/agent/skills`), Antigravity (`~/.gemini/config/skills`), and Codex (`~/.codex/skills`).

## Phase 2: Install System Dependencies (Ubuntu / Debian)

Run as root or via `sudo`:

1. Install Node.js `>=22` if missing (`node -v`).
2. Install display, VNC, and clipboard packages:
   ```bash
   sudo apt-get update
   sudo apt-get install -y xvfb openbox x11vnc novnc websockify xclip curl ca-certificates git
   ```
3. Install official `google-chrome-stable` (x86_64 `.deb`, or `chromium` on ARM64 / when preferred):
   ```bash
   if ! command -v google-chrome-stable >/dev/null 2>&1; then
     curl -fsSL -o /tmp/google-chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
     sudo apt-get install -y /tmp/google-chrome.deb
     rm -f /tmp/google-chrome.deb
   fi
   ```

## Phase 3: Clone, Build & Wire CLI + Skills (As Target User)

Run as the target non-root user:

```bash
mkdir -p ~/dev ~/.local/bin ~/.agents/skills \
  ~/.config/ego-browser/plugins ~/.config/ego-browser/extensions \
  ~/.local/share/ego-browser/profile ~/.ego-browser/state

git clone https://github.com/joyehuang/ego-browser-linux.git ~/dev/ego-browser-linux
cd ~/dev/ego-browser-linux
(cd package/ego-browser && CI=true npm ci && npm run build)

ln -sf "$HOME/dev/ego-browser-linux/package/ego-linux/bin/ego-browser.mjs" "$HOME/.local/bin/ego-browser"
chmod +x "$HOME/dev/ego-browser-linux/package/ego-linux/bin/ego-browser.mjs"

rm -rf "$HOME/.agents/skills/ego-browser"
cp -a "$HOME/dev/ego-browser-linux/package/ego-browser/dist/out/agent-skills/ego-browser" "$HOME/.agents/skills/ego-browser"
```

Wire requested agent directories (only create symlinks where requested / applicable):

```bash
mkdir -p ~/.claude/skills ~/.pi/agent/skills ~/.gemini/config/skills ~/.codex/skills
ln -sfn ../../.agents/skills/ego-browser ~/.claude/skills/ego-browser
ln -sfn ../../../.agents/skills/ego-browser ~/.pi/agent/skills/ego-browser
ln -sfn ../../../.agents/skills/ego-browser ~/.gemini/config/skills/ego-browser
ln -sfn ../../.agents/skills/ego-browser ~/.codex/skills/ego-browser
```

Ensure `~/.local/bin` is on `PATH` in `~/.profile` / `~/.bashrc` if missing.

## Phase 4: Configure `env` & Deploy `systemd` Services

1. Create `~/.config/ego-browser/env` from `deploy/env.example` with `chmod 600` (match user's choices from Phase 1):
   ```bash
   install -m 600 "$HOME/dev/ego-browser-linux/deploy/env.example" "$HOME/.config/ego-browser/env"
   ```
   Update paths (`{{HOME}}` -> actual `$HOME`), `TZ`, `EGO_SSH_HOST`, `EGO_CONSOLE_HOST` / `EGO_CONSOLE_PUBLIC_URL` / `EGO_CONSOLE_TOKEN`, and `EGO_LINUX_PROXY` (remove `EGO_LINUX_PROXY` if no proxy is desired).

2. Render `deploy/systemd/ego-{xvfb,openbox,x11vnc,novnc,chrome,console}.service.tmpl` into `/etc/systemd/system/` replacing `{{USER}}`, `{{GROUP}}`, `{{HOME}}`, `{{REPO_DIR}}`, `{{PROFILE_DIR}}`, `{{CDP_PORT}}` (`19222`), `{{VNC_PORT}}` (`5900`), `{{NOVNC_PORT}}` (`6081`), `{{CONSOLE_PORT}}` (`6080`), `{{SOCKS_PORT}}` (`10809` or omit `--proxy-server` if direct), and optional `socks-tunnel.service.tmpl`:
   - Keep `x11vnc` IPv4-only loopback (`-listen 127.0.0.1 -no6 -noipv6 -rfbportv6 -1`).
   - Keep `ego-novnc.service` on `127.0.0.1:6081` (`--web=/usr/share/novnc 127.0.0.1:6081 127.0.0.1:5900`).
   - Keep `ego-chrome.service` with `KillMode=mixed`, `TimeoutStopSec=15`, `RestartSec=1`, and persistent `--user-data-dir=$HOME/.local/share/ego-browser/profile`.
   - Keep `ego-console.service` running `ego-browser.mjs --console` with `EnvironmentFile=$HOME/.config/ego-browser/env`.

3. Enable and start in dependency order:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now ego-xvfb ego-openbox ego-x11vnc ego-novnc ego-chrome ego-console
   ```

## Phase 5: Mandatory End-to-End Verification

Run ALL checks below as the target user before reporting completion:

1. **Systemd & Loopback Binding**:
   ```bash
   systemctl is-active ego-xvfb ego-openbox ego-x11vnc ego-novnc ego-chrome ego-console
   ss -tlnp | grep -E ':(5900|6080|6081|19222)\b'
   ```
   Confirm `5900`, `6081`, and `19222` listen strictly on `127.0.0.1`. Confirm `6080` matches the user's chosen access mode.
2. **CLI & CDP Health**:
   ```bash
   ego-browser --status
   curl -sf http://127.0.0.1:6080/api/status
   ```
   Confirm `"running": true`, `"chromeConnected": true`, and `"vncEnabled": true` (replace `127.0.0.1` with `EGO_CONSOLE_HOST` if bound to a Tailscale IP).
3. **Isolated E2E Workflow Smoke Test**:
   ```bash
   ego-browser run smoke-demo.checkPage \
     --plugin "$HOME/dev/ego-browser-linux/examples/plugins/e2e-smoke-demo.mjs" \
     --arg url=https://example.com \
     --arg expect="Example Domain"
   ```
   Confirm exit code `0` and JSON `"ok": true`.
4. **Usage Guide Check**:
   ```bash
   ego-browser skill | head -n 5
   ```
5. **Final Handoff Instructions for the User**:
   - Provide the Console URL (`http://127.0.0.1:6080/` for SSH tunnel + `ssh -N -L 6080:127.0.0.1:6080 <vps-host>`, or their Tailscale / public HTTPS URL).
   - Remind the user they can open a persistent `New Space` in the Console to sign into GitHub/Google/SaaS once (`Default` profile persists across restarts), while using `Isolated` Spaces (`profileId: "isolated"`) for zero-login E2E testing.

## Phase 6: Upgrade & Uninstall

- **Upgrade**:
  ```bash
  cd ~/dev/ego-browser-linux && git pull
  (cd package/ego-browser && npm run build)
  cp -a package/ego-browser/dist/out/agent-skills/ego-browser ~/.agents/skills/
  sudo systemctl restart ego-console
  ```
- **Uninstall**:
  ```bash
  sudo systemctl disable --now ego-console ego-chrome ego-novnc ego-x11vnc ego-openbox ego-xvfb
  sudo rm -f /etc/systemd/system/ego-*.service && sudo systemctl daemon-reload
  ```
