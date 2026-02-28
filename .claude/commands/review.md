# Review Code

Review recent code changes against the project spec and conventions using the reviewer agent.

## Instructions

1. Run `git diff` to see uncommitted changes, or `git log --oneline -10` + `git diff HEAD~1` for the latest commit
2. Read `IMPLEMENTATION.md` for spec compliance
3. Read `CLAUDE.md` for conventions
4. Review every changed file against the reviewer checklist:
   - Spec compliance (data model, protocol, storage format)
   - Code quality (TypeScript strict, error handling, CM6 patterns)
   - Architecture (local-first, no coupling, clean module boundaries)
   - Testing (coverage, edge cases)
   - Performance (CM6 efficiency, debounced I/O)
5. Output findings as `[BLOCKER|WARNING|NOTE] file:line — description`
6. End with a verdict: APPROVE, REQUEST CHANGES, or COMMENT

## Arguments

$ARGUMENTS — optional scope: "staged", "unstaged", "last-commit", or a specific file path. Defaults to all uncommitted changes.
