# ego-browser-linux Deployment

Parameterized systemd templates and environment configuration for running a self-hosted, headed Chrome CDP runtime on a Linux VPS (`Xvfb` + `openbox` + `x11vnc` + `noVNC` + Unified `ego-console` + optional SOCKS5 egress proxy), with all internal listeners bound to `127.0.0.1` by default.

For the full threat model and hardening checklist, see [SECURITY.md](../SECURITY.md).

## 1. Install Dependencies

On Ubuntu/Debian (with `google-chrome-stable`, `xvfb`, and Node.js 22+ installed):

```bash
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y openbox x11vnc novnc websockify xclip
```

## 2. Create Runtime Directories & Env File

Run as the target unprivileged user (never commit personal IPs, SSH aliases, or tokens into git):

```bash
install -d -m 755 \
  "$HOME/.local/share/ego-browser/profile" \
  "$HOME/.ego-browser/state" \
  "$HOME/.config/ego-browser/plugins"
```

Copy `deploy/env.example` to `~/.config/ego-browser/env`, fill in the `{{...}}` placeholders, and lock down permissions:

```bash
cp deploy/env.example "$HOME/.config/ego-browser/env"
chmod 600 "$HOME/.config/ego-browser/env"
```

Optional: copy `deploy/profiles.json.example` to `~/.config/ego-browser/profiles.json` to define custom `isolated` or `isolated-seeded` profile presets.

## 3. Optional: SOCKS5 / HTTP Proxy Setup (Residential / Dual-ISP Egress)

Cloud datacenter IPs frequently trigger CAPTCHAs, login challenges, or WAF blocks. To route Chrome traffic through a clean residential / dual-ISP exit node:

1. Point `EGO_LINUX_PROXY` (and `--proxy-server` in `ego-chrome.service`) to your local or upstream proxy (e.g. `socks5://127.0.0.1:10809` or `http://127.0.0.1:8080`).
2. Keep `--host-resolver-rules="MAP * ~NOTFOUND , EXCLUDE 127.0.0.1"` and `--force-webrtc-ip-handling-policy=disable_non_proxied_udp` enabled so DNS lookups and WebRTC ICE candidates never leak the VPS datacenter IP.

### Option A: Plain SSH Dynamic SOCKS5 Tunnel

In `socks-tunnel.service.tmpl`, use `ssh -N -D 127.0.0.1:{{SOCKS_PORT}} {{SOCKS_SSH_HOST}}` to forward browser traffic over SSH to your exit host.

### Option B: Remote `sing-box` Loopback SOCKS Inbound (Traffic Accounting)

If your exit host runs `sing-box` and you want browser traffic counted in Clash API / Zashboard, install `deploy/sing-box/10-ego-socks.json.example` on the exit host:

```bash
# On the exit host:
sudo install -m 640 -o root -g sing-box deploy/sing-box/10-ego-socks.json.example /etc/sing-box/10-ego-socks.json
sudo sing-box check -D /var/lib/sing-box -C /etc/sing-box
sudo systemctl reload sing-box
```

Then keep `-L 127.0.0.1:{{SOCKS_PORT}}:127.0.0.1:{{SOCKS_PORT}}` in `socks-tunnel.service.tmpl`.

If you do not need a proxy, omit `socks-tunnel.service` and remove `--proxy-server`, `--proxy-bypass-list`, and `--host-resolver-rules` from `ego-chrome.service`.

## 4. Render & Install Systemd Units

All `.tmpl` files under `deploy/systemd/` use `{{PLACEHOLDER}}` tokens:

| Placeholder | Example | Description |
| --- | --- | --- |
| `{{USER}}` / `{{GROUP}}` | `appuser` | Unprivileged Linux user/group owning the services and Chrome profile |
| `{{HOME}}` | `/home/appuser` | User home directory |
| `{{REPO_DIR}}` | `/home/appuser/dev/ego-browser-linux` | Checkout path of `ego-browser-linux` |
| `{{PROFILE_DIR}}` | `/home/appuser/.local/share/ego-browser/profile` | Persistent Chrome `--user-data-dir` |
| `{{DISPLAY}}` / `{{DISPLAY_NUM}}` | `:99` / `99` | Xvfb display and X11 socket number |
| `{{CDP_PORT}}` | `19222` | Chrome DevTools Protocol port on `127.0.0.1` |
| `{{SOCKS_PORT}}` | `10809` | Optional local SOCKS5 listener port on `127.0.0.1` |
| `{{SOCKS_SSH_HOST}}` | `proxy-hop` | SSH host alias from `~/.ssh/config` (optional) |
| `{{SOCKS_SERVICE}}` | `socks-tunnel.service` | Unit name providing the SOCKS5 listener (optional) |
| `{{VNC_PORT}}` | `5900` | `x11vnc` RFB port on `127.0.0.1` (`-no6 -rfbportv6 -1` disables IPv6 wildcard) |
| `{{NOVNC_PORT}}` | `6081` | Upstream `websockify` / noVNC port on `127.0.0.1` |

Note that `ego-console.service.tmpl` reads `EGO_CONSOLE_HOST`, `EGO_CONSOLE_PORT`, `EGO_VNC_UPSTREAM`, `EGO_CONSOLE_PUBLIC_URL`, and `EGO_CONSOLE_TOKEN` directly from `EnvironmentFile={{HOME}}/.config/ego-browser/env`—you do not need to edit the unit file when switching Console access modes.

Render the templates into `/etc/systemd/system/`, then reload and enable:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now \
  socks-tunnel.service \
  ego-xvfb.service \
  ego-openbox.service \
  ego-x11vnc.service \
  ego-novnc.service \
  ego-chrome.service \
  ego-console.service
```

Security & runtime notes:
- `x11vnc` passes `-listen 127.0.0.1 -no6 -noipv6 -rfbportv6 -1` to prevent Debian/Ubuntu builds from binding `[::]:5900`.
- `ego-chrome.service` uses `KillMode=mixed`, `TimeoutStopSec=15`, and `RestartSec=1` so `NetworkService` flushes SQLite cookies cleanly on stop while recovering within ~1 second if the last Chrome window is closed inside noVNC (paired with `ego-console`'s automatic CDP reconnect and one-click Reopen overlay).
- Never pass `--enable-automation` or `--no-sandbox` to Chrome.
- Never expose raw CDP (`19222`) or VNC (`5900`) beyond `127.0.0.1`.

## 5. Accessing the Unified Web Console (3 Modes)

`ego-console.service` serves the TaskSpace sidebar, browser toolbar, and embedded noVNC proxy on one port (default `6080`). Choose whichever access mode fits your network:

### Mode 1: SSH Tunnel (Default — Zero Network Exposure)

Keep the defaults in `~/.config/ego-browser/env`:

```dotenv
EGO_CONSOLE_HOST=127.0.0.1
EGO_CONSOLE_PORT=6080
EGO_VNC_UPSTREAM=127.0.0.1:6081
EGO_SSH_HOST=<vps-host>
```

From your workstation:

```bash
ssh -N -L 6080:127.0.0.1:6080 <vps-host>
```

Open `http://127.0.0.1:6080/` or any direct handoff link (`http://127.0.0.1:6080/?space=<id>`) printed by `task.handOff()`.

### Mode 2: Tailscale / ZeroTier Direct Binding (Private Mesh)

**Option 2a — Direct private-mesh bind (1-line env change):**

Edit `~/.config/ego-browser/env` to bind directly to your node's Tailscale or ZeroTier IP:

```dotenv
EGO_CONSOLE_HOST=100.x.y.z
EGO_CONSOLE_PORT=6080
EGO_CONSOLE_PUBLIC_URL=http://100.x.y.z:6080
# Optional extra layer:
# EGO_CONSOLE_TOKEN=<random-32-byte-hex>
```

Restart the console unit:

```bash
sudo systemctl restart ego-console.service
```

**Option 2b — Tailscale Serve HTTPS (loopback + automatic TLS):**

Keep `EGO_CONSOLE_HOST=127.0.0.1` and publish over your Tailnet with HTTPS:

```bash
tailscale serve --bg 6080
```

Set `EGO_CONSOLE_PUBLIC_URL=https://<node>.<tailnet>.ts.net` in `~/.config/ego-browser/env` and restart `ego-console.service`. `task.handOff()` now emits directly clickable HTTPS deep-links with no SSH forward required.

### Mode 3: Public Domain + Reverse Proxy (Caddy / Nginx / Cloudflare Tunnel + Token)

> **Important:** Never expose `ego-console` to the public internet without both TLS and authentication (`EGO_CONSOLE_TOKEN`, and/or Zero-Trust Access).

1. Keep `EGO_CONSOLE_HOST=127.0.0.1` and configure `~/.config/ego-browser/env`:

   ```dotenv
   EGO_CONSOLE_HOST=127.0.0.1
   EGO_CONSOLE_PORT=6080
   EGO_CONSOLE_PUBLIC_URL=https://browser.example.com
   EGO_CONSOLE_TOKEN=<generate-with-openssl-rand-hex-32>
   # Keep 0 (recommended) so tokens stay out of logs/chat; set 1 only if you want one-click tokenized links.
   EGO_CONSOLE_INCLUDE_TOKEN_IN_URL=0
   ```

   Restart `ego-console.service`.

2. Configure your reverse proxy (make sure WebSockets and `X-Forwarded-Proto: https` are forwarded so `ego_console_token` cookies get the `Secure` attribute):

   **Caddy (`/etc/caddy/Caddyfile`):**

   ```caddyfile
   browser.example.com {
     reverse_proxy 127.0.0.1:6080
   }
   ```

   **Nginx:**

   ```nginx
   server {
     listen 443 ssl http2;
     server_name browser.example.com;

     location / {
       proxy_pass http://127.0.0.1:6080;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_read_timeout 3600s;
     }
   }
   ```

   **Cloudflare Tunnel (`cloudflared`):**

   Point a tunnel hostname (`browser.example.com`) to `http://127.0.0.1:6080` and protect it with a Cloudflare Access policy (plus `EGO_CONSOLE_TOKEN` for defense in depth).
