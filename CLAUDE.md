# obsidian-agent-comments

Open source Obsidian plugin (MIT) for bidirectional inline comment threads between humans and AI agents on markdown documents. The plugin defines a protocol — any backend can implement it.

**Repo:** `github.com/remiphilippe/obsidian-agent-comments`

## Tech Stack

- **Language:** TypeScript (strict mode, `noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess`)
- **Platform:** Obsidian plugin API (min app version 1.4.0)
- **Editor:** CodeMirror 6 — provided by Obsidian, never bundle your own CM6 packages
- **Build:** esbuild 0.25.x (standard Obsidian sample plugin pattern)
- **Testing:** vitest 4.x (spec-driven: write tests for expected behavior, not implementation)
- **Linting:** ESLint with `eslint-plugin-obsidianmd` + typescript-eslint
- **Package manager:** npm
- **Node.js:** v22+ (use nvm if needed: `nvm use 22`)
- **Module format:** ESM source (`"type": "module"` in package.json), CJS output (esbuild bundles to `main.js`)

## Critical: CodeMirror 6 Dependency Rule

**Never install `@codemirror/*` or `@lezer/*` packages as dependencies.** Obsidian provides these at runtime. The esbuild config marks them as externals. If you import a different version than what Obsidian uses, the plugin will silently fail. Import from `@codemirror/state`, `@codemirror/view`, etc. directly — esbuild resolves them to Obsidian's bundled versions.

## Repository Structure

```
/
├── CLAUDE.md                  # This file — project conventions for Claude Code
├── IMPLEMENTATION.md          # Full implementation spec
├── manifest.json              # Obsidian plugin manifest
├── versions.json              # Plugin version → min Obsidian version mapping
├── package.json
├── tsconfig.json
├── esbuild.config.mjs
├── .gitignore
├── src/
│   ├── main.ts                # Plugin entry point (extends Plugin)
│   ├── settings.ts            # Plugin settings tab (PluginSettingTab)
│   ├── models/
│   │   ├── thread.ts          # CommentThread, TextAnchor, ThreadMessage, Suggestion
│   │   └── backend.ts         # AgentCommentsBackend protocol interface
│   ├── storage/
│   │   ├── sidecar.ts         # Read/write .agent-comments.json sidecar files
│   │   └── anchor.ts          # Anchor resolution and re-anchoring logic
│   ├── backend/
│   │   ├── local.ts           # Local-only backend (no network, sidecar-only)
│   │   ├── websocket.ts       # WebSocket backend client
│   │   └── rest.ts            # REST fallback backend client
│   ├── editor/
│   │   ├── decorations.ts     # CM6 gutter decorations and inline diffs
│   │   ├── state.ts           # CM6 StateField for thread data + StateEffects
│   │   └── suggestion-widget.ts # CM6 WidgetType for suggestion diffs
│   ├── views/
│   │   ├── thread-panel.ts    # Right sidebar thread panel (ItemView) — includes orphaned thread UI
│   │   └── thread-detail.ts   # Thread conversation view
│   └── utils/
│       ├── ids.ts             # UUID generation
│       └── diff.ts            # Text diff utilities for suggestions
├── styles.css                 # Plugin styles
└── tests/
    ├── models/
    ├── storage/
    ├── backend/
    └── editor/
```

## Key Architecture

- **Protocol-first:** The plugin is backend-agnostic. `AgentCommentsBackend` is the contract. Backends implement it via WebSocket, REST, or locally.
- **Sidecar storage:** Thread data lives in `.agent-comments.json` files next to each document. Markdown stays clean. This is a deliberate departure from CriticMarkup's inline approach which pollutes document content and causes data loss risks.
- **CM6 decorations:** Thread indicators render as gutter marks (editing mode) or margin badges (reading mode). Suggestion diffs render inline via `WidgetType`.
- **CM6 state architecture:** `StateField` holds thread data (immutable, transactional). `ViewPlugin` manages DOM/UI derived from that state. `Compartment` for reconfigurable features (resolved thread visibility, preview modes). This separation is critical — CriticMarkup validates this pattern.
- **Triple-layer anchoring:** Anchors use offset + anchorText + sectionHeading for resilience across edits. Use an interval tree (`@flatten-js/interval-tree`) for O(log n) range lookups and offset updates on large documents.
- **Extension point:** `knowledgeRefs` in messages is opaque `string[]`. External plugins register CM6 decoration providers to render them. This plugin never interprets them.
- **Offline-first:** The sidecar file is always the source of truth, not the backend. All human operations (create thread, add message, accept/reject suggestion, resolve/reopen) write to sidecar immediately and work regardless of connection state. The backend is notified asynchronously — if connected, changes are sent; if disconnected, changes queue in an outbox and drain on reconnect. The message composer is never disabled. No feature is gated behind a live connection except "Section regeneration" (which requires an agent response).

## Lessons from Prior Art (obsidian-criticmarkup)

[Fevol/obsidian-criticmarkup](https://github.com/Fevol/obsidian-criticmarkup) is the closest prior art — CriticMarkup-based commenting and suggestion tracking in Obsidian. It has excellent CM6 work but carries a data loss warning and 43 issues documenting real-world failures. Study it for CM6 patterns; avoid its architectural mistakes.

**Adopt:**
- Interval tree (`@flatten-js/interval-tree`) for O(log n) range queries and offset updates — their core performance insight
- `Compartment` for feature toggles (resolved visibility, preview modes) — settings changes take effect immediately via `reconfigure()`, no restart required (their issue #4)
- StateField for data truth, ViewPlugin for DOM management — proven separation
- Cursor movement handling around decorated ranges — users need to navigate naturally through/around widgets

**Avoid:**
- Inline storage in markdown — CriticMarkup syntax pollutes documents, causes parsing fragility, and they acknowledge "non-zero risk of text being removed" (issues #3, #13, #14, #27, #36). Our sidecar approach eliminates this entire class of bugs.
- Transaction filter for input interception — root cause of their wikilink breakage (#34, #37), Vim mode breakage (#39), autocomplete conflicts (#25), multi-cursor failure (#38), and IME corruption (#36). We never intercept editor transactions.
- Comment thread reconstruction after every parse — their threads are reconstructed by adjacency after each document change, leading to duplication bugs. Our threads have stable IDs in sidecar files.
- Widget destruction on selection changes — their `CommentIconWidget` is unnecessarily destroyed and recreated on every selection change. Override `WidgetType.eq()` to prevent unnecessary DOM churn.
- Unvalidated metadata parsing — they have a documented `TODO: JS can be injected here, possible security risk` in their metadata parser. We validate all sidecar data against a schema.
- Excessive dependencies (Svelte, localforage, Lezer custom grammar, sass, inline workers) — we keep runtime deps to `@flatten-js/interval-tree` and `diff-match-patch` beyond `obsidian`.
- Global CSS for gutters — their gutter CSS breaks Canvas/Kanban views (#21). Scope all gutter and decoration styles to markdown editor views only.

**Pitfalls to test against (from their issue tracker):**
- Gutter + Obsidian "Show line numbers" coexistence — their gutter breaks when line numbers are enabled (#24)
- Gutter eating into readable line width — their annotation panel reduces text area to 400px (#31)
- Initialization ordering — they crash on fresh install because StateFields are accessed before registration (#16, #18). Use `workspace.onLayoutReady()` for deferred init.
- File type filtering — they accidentally index non-markdown files (#6). Only process `.md` files.
- Thread creation feedback — their users can't tell if "Add Comment" succeeded (#35, #43). We must show immediate visual feedback: gutter dot + sidebar scroll + focused composer.
- BRAT installation — test early that our manifest works with BRAT (#32)

## Coding Conventions

- TypeScript strict mode. No `any` types unless interfacing with Obsidian's untyped APIs (document the cast with a comment).
- Follow Obsidian plugin patterns: extend `Plugin`, use `ItemView` for sidebar panels, register commands via `this.addCommand()`, register extensions via `this.registerEditorExtension()`.
- CM6 state management: use `StateField` + `StateEffect` pattern. Never mutate state directly.
- CM6 extension choice: prefer `ViewPlugin` over `StateField` for decorations that depend only on viewport content (better performance). Use `StateField` when decorations need to persist outside viewport.
- Use `crypto.randomUUID()` for IDs. Fall back to a simple UUID v4 implementation for mobile environments that lack it.
- Use ISO 8601 strings for all timestamps.
- Name sidecar files as `{document-basename}.agent-comments.json` in the same directory.
- Error handling: surface errors via `Notice` (Obsidian's toast system), never `alert()` or `confirm()`.
- Clean up in `onunload()`: deregister event listeners, close WebSocket connections, clean up views.

## Security Practices

- **Input validation:** Validate all data read from sidecar `.agent-comments.json` files against the expected schema before use. Malformed files must not crash the plugin.
- **WebSocket security:** Only connect to user-configured endpoints. Validate the URL scheme (`ws://` or `wss://`). Prefer `wss://` in docs and defaults.
- **No eval/innerHTML:** Never use `eval()`, `new Function()`, or `innerHTML` with untrusted content. Use DOM API (`createElement`, `textContent`) or Obsidian's `sanitizeHTMLToDom()` for any HTML rendering.
- **Message content:** Thread message content is user/agent-generated text. Always render as text nodes, never as raw HTML. If markdown rendering is needed, use Obsidian's `MarkdownRenderer.render()`.
- **Suggestion application:** When applying suggestions, validate that `originalText` matches the current document content at the anchor position before replacing. Never blindly apply replacements.
- **Dependency minimalism:** Keep runtime dependencies to the absolute minimum: `obsidian` (platform), `@flatten-js/interval-tree` (range management), `diff-match-patch` (semantic diff). No frameworks (React, Svelte, Vue). No ORMs. No utility libraries (lodash, etc.). All deps must be pinned or use `^` with lock file committed.
- **No secrets in sidecar files:** Sidecar files live alongside markdown in the vault. Never store API keys, tokens, or credentials in them. Backend auth configuration belongs in plugin settings (Obsidian's encrypted storage).

## Testing

### Philosophy

- **Test expected behavior, not implementation.** Write tests based on the spec in IMPLEMENTATION.md. If the spec says "re-anchoring survives insertions before the anchor," write a test that inserts text before an anchor and asserts the anchor resolves correctly — regardless of how the code currently works.
- **No snapshot tests.** Snapshots test implementation, not behavior. Write explicit assertions.
- **Test edge cases and failure modes**, not just happy paths.

### Setup

- **Framework:** vitest 4.x with `vitest.config.ts` at the repo root.
- **Test files:** Co-located in `tests/` mirroring `src/` structure. Named `*.test.ts`.
- **Run:** `npm test` (all tests), `npx vitest run tests/storage/` (specific dir), `npx vitest run -t "re-anchoring"` (by name).

```
tests/
├── models/
│   └── thread.test.ts          # Data model creation, validation, serialization
├── storage/
│   ├── sidecar.test.ts         # Sidecar read/write, malformed files, missing files
│   └── anchor.test.ts          # Re-anchoring across edits, orphan detection
├── backend/
│   ├── local.test.ts           # Local backend thread lifecycle
│   └── websocket.test.ts       # WebSocket message parsing, reconnection
└── editor/
    ├── state.test.ts           # StateField create/update, StateEffect dispatch
    └── suggestion-widget.test.ts # Suggestion diff rendering logic
```

### Mocking Obsidian APIs

Obsidian types are not designed for unit testing. Create a `tests/__mocks__/obsidian.ts` module that exports minimal stubs:

```typescript
// tests/__mocks__/obsidian.ts
export class Notice {
  constructor(public message: string) {}
}

export class TFile {
  constructor(
    public path: string,
    public basename: string,
    public extension: string
  ) {}
}

export class Vault {
  private files = new Map<string, string>();

  async read(file: TFile): Promise<string> {
    return this.files.get(file.path) ?? '';
  }

  async modify(file: TFile, data: string): Promise<void> {
    this.files.set(file.path, data);
  }

  // Add methods as needed for specific tests
}

export const Platform = { isMobile: false, isDesktop: true };
```

Configure vitest to resolve `obsidian` imports to this mock:

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    alias: {
      obsidian: './tests/__mocks__/obsidian.ts',
    },
  },
  resolve: {
    alias: {
      src: './src',
    },
  },
});
```

### What to Test (by module)

**Models (`thread.test.ts`)**
- Thread creation with valid/invalid anchors
- Message ordering by timestamp
- Suggestion state machine: `pending` → `accepted`, `pending` → `rejected`, no other transitions
- Serialization round-trip: `CommentThread` → JSON → `CommentThread` with all fields preserved

**Storage (`sidecar.test.ts`)**
- Read valid `.agent-comments.json` → returns typed `CommentThread[]`
- Read malformed JSON → returns empty array + surfaces error (does not throw)
- Read missing file → returns empty array (first use)
- Write threads → produces valid JSON matching the sidecar schema
- Schema version check: reject future versions gracefully

**Storage (`anchor.test.ts`)**
- Anchor resolves by exact offset when text unchanged
- Anchor resolves by `anchorText` match when text shifts (insertion before anchor)
- Anchor resolves by `sectionHeading` fallback when `anchorText` partially matches
- Anchor becomes orphaned when `anchorText` is deleted entirely
- Multiple anchors in same section don't interfere
- Edge cases: anchor at offset 0, anchor at end of document, empty document

**Backend (`local.test.ts`)**
- `createThread` → thread exists in storage with correct ID, anchor, first message
- `addMessage` → message appended, `updatedAt` changes
- `resolveThread` → status becomes `'resolved'`
- `reopenThread` → status becomes `'open'`
- `acceptSuggestion` → suggestion status `'accepted'`, original text replaced in document
- `rejectSuggestion` → suggestion status `'rejected'`, document unchanged
- `acceptSuggestion` when `originalText` doesn't match → error, document unchanged

**Backend (`websocket.test.ts`)**
- Parse incoming messages (new thread, new message, suggestion)
- Reconnection with exponential backoff
- Message queue during disconnection (if applicable)

**Editor (`state.test.ts`)**
- `StateField.create` returns empty `DecorationSet` for document with no threads
- Dispatching add-thread `StateEffect` updates decoration set
- Dispatching resolve-thread `StateEffect` changes decoration style
- Decorations map correctly to document positions

### Security-Specific Tests

- Sidecar file with `<script>` tags in message content → rendered as text, not executed
- Sidecar file with unexpected top-level keys → parsed without error, extra keys ignored
- Thread message with `author` containing path traversal characters → no file system impact
- Suggestion `replacementText` with markdown injection → applied as literal text

## Build & Test

```bash
# Install dependencies
npm install

# Development build (watch mode)
npm run dev

# Production build (type-check + bundle)
npm run build

# Run tests
npm test

# Lint
npm run lint
```

## Obsidian Plugin Development

- **Hot reload:** Copy `main.js`, `manifest.json`, and `styles.css` to your vault's `.obsidian/plugins/agent-comments/` directory. Use `obsidian plugin:reload id=agent-comments` CLI command or the Hot Reload community plugin.
- **Minimum Obsidian version:** 1.4.0 (CM6 stable API)
- **Mobile support:** Required. Use `Platform.isMobile` for mobile-specific UI (bottom sheet vs sidebar).
- **Dev tools:** `obsidian dev:open` opens Chromium DevTools for debugging.

## Dependency Versions (pinned from official sample plugin)

These are the reference versions from the [Obsidian sample plugin](https://github.com/obsidianmd/obsidian-sample-plugin). Use latest compatible versions:

| Package | Version | Notes |
|---------|---------|-------|
| `obsidian` | `latest` | Provided by Obsidian app at runtime |
| `@flatten-js/interval-tree` | `^1.1.0` | O(log n) range management, validated by CriticMarkup |
| `diff-match-patch` | `^1.0.5` | Semantic diff (~6KB, zero transitive deps), used by CriticMarkup and Google |
| `typescript` | `^5.8.3` | |
| `esbuild` | `0.25.5` | Match sample plugin exactly |
| `@types/node` | `^22.0.0` | Match our Node.js version |
| `tslib` | `2.4.0` | Import helpers |
| `eslint-plugin-obsidianmd` | `0.1.9` | Obsidian-specific lint rules |
| `typescript-eslint` | `8.35.1` | |
| `@eslint/js` | `9.30.1` | |
| `globals` | `14.0.0` | |
| `vitest` | `^4.0.0` | Testing framework |

## Important References

- `IMPLEMENTATION.md` — Full implementation spec with data model, protocol, features, and phases
- [Obsidian Developer Docs — Build a Plugin](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin)
- [Obsidian Developer Docs — Editor Extensions](https://docs.obsidian.md/Plugins/Editor/Editor+extensions)
- [Obsidian Developer Docs — Decorations](https://docs.obsidian.md/Plugins/Editor/Decorations)
- [Obsidian Sample Plugin](https://github.com/obsidianmd/obsidian-sample-plugin) — canonical build config reference
- [Obsidian Plugin Docs (community)](https://marcusolsson.github.io/obsidian-plugin-docs/) — detailed guides with code examples
- [CodeMirror 6 System Guide](https://codemirror.net/docs/guide/)
- [CodeMirror 6 Reference](https://codemirror.net/docs/ref/)

### Prior Art
- [Fevol/obsidian-criticmarkup](https://github.com/Fevol/obsidian-criticmarkup) — CriticMarkup-based commenting/suggestions in Obsidian. Study for CM6 patterns (interval tree, compartments, transaction filters, gutter implementation). Avoid its inline storage, thread reconstruction, and unvalidated metadata parsing.
