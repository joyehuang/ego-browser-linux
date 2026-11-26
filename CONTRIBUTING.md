# Contributing to `ego-browser-linux`

Thank you for your interest in contributing to `ego-browser-linux`! This guide explains the repository layout, local development workflow, coding standards, and pull request expectations.

## Repository Architecture

`ego-browser-linux` separates the upstream-aligned SDK from the Linux host layer so upstream improvements from [`citrolabs/ego-lite`](https://github.com/citrolabs/ego-lite) stay straightforward to sync:

| Layer | Path | Scope |
| --- | --- | --- |
| **Upstream SDK** | `package/ego-browser/` | Core v2 `TaskSpace` / `Page` model, snapshot compaction, element resolver, `help()`, guide renderer, and minimal Linux deltas (`xclip` clipboard + `linux` guide block). |
| **Linux Host Runtime** | `package/ego-linux/` | CDP bridge, Chrome discovery/launch, file-locked TaskSpaces (Plan A), multi-profile contexts, Unified Web Console + noVNC proxy, and Plugin & E2E Workflow loader. |
| **Agent Entry Skills** | `skills/ego-browser/` | Thin entry skill and reusable per-site learnings (`learnings/<site>/manifest.json`). |
| **Deployment Templates** | `deploy/` | Parameterized systemd unit templates (`*.tmpl`), `env.example`, `profiles.json.example`, and optional proxy configs. |
| **Documentation & Examples** | `docs/`, `examples/` | Extensibility guide, native binding specs, and example E2E workflow plugins. |

**Rule of thumb:** Put Linux-specific runtime features, Console UX, multi-profile logic, and plugin hooks in `package/ego-linux/`. Keep changes to `package/ego-browser/` minimal and well-tested.

## Prerequisites

- **Node.js 22+** (ESM throughout)
- **Google Chrome** or **Chromium** on `PATH` (for headless runtime tests)
- Optional (for headed VPS testing): `xvfb`, `openbox`, `x11vnc`, `novnc`, `websockify`, `xclip`

## Local Setup & Test Commands

Install dependencies for the SDK package (`CI=true` skips `lefthook install` if you have a global `core.hooksPath` configured):

```bash
cd package/ego-browser && CI=true npm ci
cd ../..
```

From the repository root, use the convenience npm scripts:

```bash
# Build package/ego-browser (dist/src, dist/out/index.js, rendered guides & skills)
npm run build

# Run SDK build, translation check, TypeScript typecheck, and unit tests
npm run test:sdk

# Run Linux host runtime tests (headless Chrome)
npm run test:linux

# Run both SDK and Linux runtime test suites
npm test

# Validate learned site skills under skills/ego-browser/learnings/
npm run validate:site-skills

# Check Prettier formatting in package/ego-browser/
npm run style:check
```

## Code Style & Conventions

- **ESM only** (`"type": "module"`), targeting **Node.js 22+**.
- **`package/ego-browser/`**: TypeScript + Prettier. Always run `npm run style:check` and `npm run test:sdk` before opening a PR. Keep `skill-body/SKILL.md` concise so the all-platform rendered guide stays under `maxGuideLength` (25,000 characters).
- **`package/ego-linux/`**: Dependency-free modern JavaScript (`.mjs`) using Node's built-in test runner (`node --test` + `node:assert/strict`). Colocate tests in `package/ego-linux/test/*.test.mjs`.
- **No external CDNs in Console UI**: `package/ego-linux/src/spaces-ui.mjs` is intentionally self-contained so it works offline over SSH tunnels and private meshes.
- **Privacy & Security**: Never commit personal IP addresses, SSH host aliases, tokens, cookies, `.env` files, or Chrome profile directories. Use placeholders (`<vps-host>`, `100.x.y.z`, `browser.example.com`, `{{USER}}`) in docs and templates.

## Authoring Plugins & E2E Workflows

Before adding new core runtime code, consider whether your use case fits cleanly as a plugin under `~/.config/ego-browser/plugins/` or a repo-local `--plugin <path>` module.

- Read [docs/extensibility.md](docs/extensibility.md) for the plugin contract (`helpers`, `workflows`, `ctx.withSpace`).
- Inspect [examples/plugins/e2e-smoke-demo.mjs](examples/plugins/e2e-smoke-demo.mjs) for a working isolated E2E workflow.
- Test offline discovery with `ego-browser plugins --plugin <path> --json`.

## Submitting a Pull Request

1. Fork the repository and create a descriptive feature or fix branch off `main`.
2. Add or update unit tests covering your changes.
3. Run the full verification suite:
   ```bash
   npm test
   npm run validate:site-skills
   npm run style:check
   ```
4. Open a PR using the repository PR template, describing the motivation, behavior change, and verification steps.
5. Update `CHANGELOG.md` under `[Unreleased]` for user-visible changes.
