# Security Policy

## Supported Versions

| Version | Supported |
| --- | --- |
| `0.1.x` / `main` | Yes |

## Security Architecture & Threat Model

`ego-browser-linux` drives a real Chromium/Chrome browser over the Chrome DevTools Protocol (CDP) and exposes a live display over VNC/noVNC. Misconfiguring network bindings can give an attacker full access to logged-in browser sessions, cookies, and clipboard data.

Follow these boundaries carefully when deploying on a Linux server or VPS.

### 1. Loopback-Only Default (`127.0.0.1`)

All internal listeners bind strictly to `127.0.0.1` by default:

| Service | Default Bind | Never Expose Publicly |
| --- | --- | --- |
| Chrome CDP (`ego-chrome`) | `127.0.0.1:19222` | **CRITICAL:** Raw CDP grants full cookie, DOM, navigation, and script execution control without authentication. |
| `x11vnc` (`ego-x11vnc`) | `127.0.0.1:5900` (`-no6 -rfbportv6 -1`) | **CRITICAL:** Runs with `-nopw` on loopback and carries full X11 display & input. |
| `websockify` / noVNC (`ego-novnc`) | `127.0.0.1:6081` | **CRITICAL:** Unauthenticated upstream VNC WebSocket bridge; fronted only by `ego-console`. |
| Unified Console (`ego-console`) | `127.0.0.1:6080` | Access via SSH tunnel, private mesh, or TLS reverse proxy + `EGO_CONSOLE_TOKEN`. |
| Optional SOCKS5 tunnel | `127.0.0.1:10809` | Loopback egress tunnel only. |

Verify bindings after deployment:

```bash
ss -tlnp | grep -E ':(5900|6080|6081|10809|19222)\b'
```

Every internal port (`5900`, `6081`, `10809`, `19222`) must appear **only** on `127.0.0.1` (never `0.0.0.0` or `[::]`).

### 2. Hardening the 3 Console Access Modes

1. **Mode 1 — SSH Tunnel *(recommended default)*:**
   - Keep `EGO_CONSOLE_HOST=127.0.0.1`.
   - Connect via `ssh -N -L 6080:127.0.0.1:6080 <vps-host>`. Zero ports are exposed outside the host.
2. **Mode 2 — Tailscale / ZeroTier Private Mesh:**
   - Prefer `tailscale serve --bg 6080` (keeps `EGO_CONSOLE_HOST=127.0.0.1` with automatic TLS).
   - If binding directly (`EGO_CONSOLE_HOST=<tailscale-ip>`), restrict Tailnet ACLs to trusted devices and optionally set `EGO_CONSOLE_TOKEN`.
3. **Mode 3 — Public Domain + Reverse Proxy (Caddy / Nginx / Cloudflare Tunnel):**
   - Keep `EGO_CONSOLE_HOST=127.0.0.1` so the Console is reachable only through your proxy.
   - Always terminate **HTTPS/TLS** at the proxy and forward `X-Forwarded-Proto: https` so the `ego_console_token` cookie receives the `Secure` attribute (alongside `HttpOnly; SameSite=Lax`).
   - Always set a high-entropy `EGO_CONSOLE_TOKEN` (`openssl rand -hex 32`), and combine with an upstream identity/Zero-Trust layer (e.g., Cloudflare Access) for defense in depth.
   - Keep `EGO_CONSOLE_INCLUDE_TOKEN_IN_URL=0` (default) so tokens are not printed into terminal logs, chat transcripts, or browser history.

`ego-console` also enforces `Origin` validation on API mutations and WebSocket upgrades (allowing loopback, the configured `EGO_CONSOLE_PUBLIC_URL`, and same-host requests while rejecting cross-origin callers with HTTP 403).

### 3. Profile & Process Isolation Boundaries

| Profile | Storage & Cookie Boundary | Notes |
| --- | --- | --- |
| `Default` | Persistent Chrome `--user-data-dir` | Shared across all `Default` TaskSpaces; retains logins across restarts. |
| `isolated` | Ephemeral CDP `BrowserContext` | Zero cookies, zero localStorage, auto-disposed when the space closes. |
| `isolated-seeded` | Ephemeral CDP `BrowserContext` seeded from `Default` cookies | Mutations do not write back to `Default`. |

**Important boundary:** Plan A concurrency shares a single Chrome process and a single Xvfb display (`:99`) across TaskSpaces. It is designed for trusted multi-agent automation owned by one operator—not for hostile multi-tenant isolation. Do not grant untrusted third parties access to the Console or CLI on a host holding personal `Default` sessions.

### 4. Local Secrets & Runtime State

- Keep `~/.config/ego-browser/env` readable only by the service user (`chmod 600`).
- Never commit `~/.config/ego-browser/env`, `~/.local/share/ego-browser/profile/`, or `~/.ego-browser/state/` to version control.
- Never pass `--no-sandbox` to Chrome in production deployments.

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, report vulnerabilities privately through **GitHub Security Advisories**:

- https://github.com/joyehuang/ego-browser-linux/security/advisories/new

Please include:
- A clear description of the vulnerability and potential impact
- Step-by-step reproduction instructions or a minimal proof of concept
- Affected commit SHA or version, OS, and deployment configuration

We aim to acknowledge reports within 72 hours and coordinate a fix and disclosure timeline with the reporter.
