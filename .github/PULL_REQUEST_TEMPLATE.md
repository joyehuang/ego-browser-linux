## Summary

<!-- Describe what this PR changes and why. Link related issues if any. -->

## Change Type

- [ ] Bug fix
- [ ] Feature / enhancement
- [ ] Documentation / deployment templates
- [ ] Refactor / tests / CI

## Verification

- [ ] `npm run test:sdk` (`package/ego-browser` build, typecheck, skill check, unit tests)
- [ ] `npm run validate:site-skills`
- [ ] `npm run style:check`
- [ ] `npm run test:linux` (`EGO_LINUX_HEADLESS=1 node --test "package/ego-linux/test/*.test.mjs"`)

## Checklist

- [ ] Changes in `package/ego-browser/` (if any) are minimal Linux-specific deltas to keep upstream sync clean.
- [ ] No private IP addresses, SSH host aliases, tokens, secrets, or Chrome profile data are included.
- [ ] Documentation (`README.md`, `deploy/README.md`, `docs/extensibility.md`, `CHANGELOG.md`) updated if user-facing behavior changed.
