# Implement Feature

Implement a feature from the IMPLEMENTATION.md checklist.

## Instructions

1. Read `IMPLEMENTATION.md` to find the feature in the phase checklist
2. Read `CLAUDE.md` for project conventions and repo structure
3. Read existing source files that will be affected
4. Plan the implementation — identify all files to create or modify
5. Implement the feature following project conventions
6. Write tests for the new functionality
7. Run `npm test` to verify tests pass
8. Run `npm run build` to verify the build succeeds
9. Mark the checklist item in `IMPLEMENTATION.md` as done with `[x]`

## Arguments

$ARGUMENTS — the feature name or description from the IMPLEMENTATION.md checklist (e.g., "bidirectional thread creation", "CM6 gutter decorations", "re-anchoring")

## Key Rules

- Follow the data model exactly as specified in IMPLEMENTATION.md
- Maintain backward compatibility with the `AgentCommentsBackend` protocol
- Local-only mode must continue to work
- Use CM6 decorations for all editor UI, no DOM hacks
- Use `Notice` for errors, never `alert()`
- TypeScript strict mode, no `any` unless required by Obsidian API
