# Scaffold Component

Scaffold a new component for the obsidian-agent-comments plugin.

## Instructions

1. Read `CLAUDE.md` for the repo structure and conventions
2. Read `IMPLEMENTATION.md` for the data model and architecture
3. Look at existing files in the same module directory for patterns to follow
4. Create the new file(s) with proper TypeScript types, imports, and exports
5. Add the file to the appropriate module's index if one exists
6. Create a corresponding test file in `tests/`
7. Verify the build still works with `npm run build`

## Arguments

$ARGUMENTS — the component to scaffold (e.g., "websocket backend", "thread panel view", "anchor resolver", "suggestion widget")

## Component Types

- **model** → `src/models/` — TypeScript interfaces and types
- **storage** → `src/storage/` — File I/O and data persistence
- **backend** → `src/backend/` — Backend protocol implementations
- **editor** → `src/editor/` — CodeMirror 6 extensions (decorations, state, widgets)
- **view** → `src/views/` — Obsidian ItemView sidebar panels
- **util** → `src/utils/` — Shared utilities
