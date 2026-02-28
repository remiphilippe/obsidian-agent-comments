# Contributing to Agent Comments

## Development setup

1. Clone the repository
2. `npm install`
3. `npm run dev` for watch mode
4. Copy `main.js`, `manifest.json`, and `styles.css` to your vault's `.obsidian/plugins/agent-comments/`
5. Enable the plugin and use the Hot Reload community plugin for live reloading

## Code conventions

- TypeScript strict mode (`noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess`)
- No `any` types unless interfacing with Obsidian's untyped APIs (document the cast)
- Follow Obsidian plugin patterns: `Plugin`, `ItemView`, `Modal`, `Notice`
- CM6 state: `StateField` + `StateEffect`, never mutate state directly
- Use `crypto.randomUUID()` for IDs
- ISO 8601 strings for timestamps
- Errors via `Notice` (Obsidian toast), never `alert()` or `confirm()`

See [CLAUDE.md](CLAUDE.md) for full conventions.

## Testing

- Framework: vitest
- Test files in `tests/` mirroring `src/` structure
- Test expected behavior, not implementation
- No snapshot tests
- All PRs must include tests for new behavior

```bash
npm test                           # all tests
npx vitest run tests/storage/      # specific directory
npx vitest run -t "re-anchoring"   # by name
```

## Pull request process

1. Fork and create a feature branch
2. Implement changes following code conventions
3. Add tests for new behavior
4. Ensure `npm run build && npm test && npm run lint` all pass
5. Submit a PR with a clear description

## Architecture

See [IMPLEMENTATION.md](IMPLEMENTATION.md) for the full specification and data model.

Key principles:
- Sidecar storage keeps markdown clean
- Offline-first: sidecar is source of truth
- Protocol-first: backend-agnostic via `AgentCommentsBackend` interface
- Never install `@codemirror/*` packages — Obsidian provides them at runtime

## Security

Report vulnerabilities via GitHub Security Advisories on this repository.

Key security practices:
- Validate all sidecar file data against schema
- No `eval()`, `innerHTML`, or `new Function()` with untrusted content
- Render message content as text or via `MarkdownRenderer.render()`
- Validate suggestion `originalText` matches document before applying
- No secrets in sidecar files
