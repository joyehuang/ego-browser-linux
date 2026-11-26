# Install ego lite on Linux

Read `install.md` first; it covers upgrading an older ego lite and the shared runtime model. This file covers the Linux `ego-browser` CLI setup, verification commands, and Linux troubleshooting.

## Setup on Linux

On Linux, `ego-browser` runs through `package/ego-linux/bin/ego-browser.mjs` linked on your `PATH` (typically `~/.local/bin/ego-browser`) and connects over CDP to a persistent headed Chrome instance under `Xvfb`, `openbox`, `x11vnc`, `noVNC`, `xclip`, and the Unified Web Console (`ego-console.service` on port `6080`).

- **AI-Native Guided Installation**: If this Linux host is not set up yet, read and follow [`skills/ego-browser-linux-install/SKILL.md`](../../ego-browser-linux-install/SKILL.md) to probe the environment, confirm the user's Console access / proxy preferences, deploy systemd services, and verify everything end-to-end.
- **Manual Systemd Templates**: See [`deploy/README.md`](../../../deploy/README.md).

## After installing: confirm `ego-browser` is available

Confirm the command is on your `PATH`:

```bash
command -v ego-browser
```

If it is missing, add `~/.local/bin` to `PATH` and retry:

```bash
export PATH="$HOME/.local/bin:$PATH"
command -v ego-browser
```

Check the backing browser connection, verify the Node.js runtime, and confirm the usage guide prints:

```bash
ego-browser --status
ego-browser nodejs <<'EOF'
console.log('ego-browser ready')
EOF
ego-browser skill
```

## Troubleshooting

- **Backing Chrome is unreachable**: run `ego-browser --status` (or check `systemctl is-active ego-chrome ego-console`) and ensure `EGO_LINUX_CDP_URL` (default `http://127.0.0.1:19222`) is listening.
- **`keyboard.paste()` fails on Linux**: ensure `xclip` is installed and `DISPLAY` (default `:99`) points to the running X server.
- **Manual login, 2FA, or CAPTCHA on a headless VPS**: forward the Console port over SSH (`ssh -N -L 6080:127.0.0.1:6080 <host>`) or use your configured `EGO_CONSOLE_PUBLIC_URL`, and open the deep-link returned by `task.handOff()` (`http://127.0.0.1:6080/?space=<id>`).
