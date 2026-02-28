# Agent Comments

Bidirectional inline comment threads between humans and AI agents on Obsidian markdown documents.

The plugin defines a protocol — any backend can implement it. Thread data lives in sidecar files next to your markdown, keeping your documents clean.

## Features

- **Inline comment threads** — select text, create a thread, discuss with agents
- **Suggestion diffs** — agents propose text changes with accept/reject workflow
- **Triple-layer anchoring** — threads survive document edits via offset, text search, and heading fallback
- **Orphaned thread recovery** — re-attach or dismiss threads when anchored text is deleted
- **Offline-first** — all operations work without a network connection; changes sync when reconnected
- **Backend-agnostic** — works locally, over WebSocket, or via REST API
- **Reading mode support** — margin badges indicate threads in preview mode
- **Mobile support** — responsive layout with touch-friendly controls
- **Knowledge refs** — extension point for external plugins to render rich references
- **Bulk operations** — resolve all threads, filter by status, search, sort

## Installation

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/remiphilippe/obsidian-agent-comments/releases/latest)
2. Create a folder `agent-comments` in your vault's `.obsidian/plugins/` directory
3. Copy the three files into that folder
4. Enable the plugin in Obsidian Settings > Community plugins

### BRAT

1. Install the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat)
2. Add `remiphilippe/obsidian-agent-comments` as a beta plugin

## Usage

### Creating threads

1. Select text in the editor
2. Run the command **Agent Comments: New comment thread** (or use the keyboard shortcut)
3. The thread panel opens with a focused composer
4. Type your comment and press Enter

### Suggestion workflow

When an agent sends a suggestion:
- A diff is shown with original and proposed text highlighted
- Click **Accept** to apply the change to the document
- Click **Reject** to dismiss the suggestion

### Thread management

- **Resolve/Reopen** — mark threads as resolved when done
- **Resolve all** — bulk resolve all open threads
- **Filter** — show all, open, resolved, or orphaned threads
- **Search** — search thread content and anchor text
- **Sort** — newest, oldest, or most messages

## Backend configuration

### Local (default)

No configuration needed. Threads are stored in `.agent-comments.json` sidecar files.

### WebSocket

1. Set **Backend type** to "WebSocket" in settings
2. Enter your WebSocket server URL (e.g., `wss://localhost:8080`)
3. The plugin connects automatically with exponential backoff reconnection

### REST API

1. Set **Backend type** to "REST API" in settings
2. Enter your REST endpoint URL (e.g., `https://localhost:8080/api`)

See [Backend Protocol](docs/protocol.md) for details on implementing a custom backend.

## Extension API

### Knowledge ref providers

External plugins can register renderers for knowledge references in thread messages:

```typescript
// In your plugin's onload()
const agentComments = this.app.plugins.plugins['agent-comments'];
agentComments.registerKnowledgeRefProvider('research:', (ref) => {
  const el = document.createElement('a');
  el.textContent = ref.slice('research:'.length);
  el.href = '#';
  return el;
});
```

## Development

```bash
# Install dependencies
npm install

# Development build (watch mode)
npm run dev

# Production build
npm run build

# Run tests
npm test

# Lint
npm run lint
```

## Architecture

- **Sidecar storage** — thread data in `.agent-comments.json` files, markdown stays clean
- **CodeMirror 6** — gutter markers and anchor highlights via StateField + ViewPlugin
- **Offline-first** — sidecar is source of truth, backend notified asynchronously
- **Protocol-first** — `AgentCommentsBackend` interface, any server can implement it

See [IMPLEMENTATION.md](IMPLEMENTATION.md) for the full specification.

## License

[MIT](LICENSE)
