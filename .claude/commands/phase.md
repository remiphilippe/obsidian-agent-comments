# Show Phase Status

Show the implementation progress for a specific phase or all phases.

## Instructions

1. Read `IMPLEMENTATION.md` section 8 (Implementation Phases)
2. Parse the checklist items and their completion status
3. If $ARGUMENTS specifies a phase number, show only that phase
4. For each phase, show:
   - Phase name and description
   - Total items vs completed items
   - List of remaining (unchecked) items
   - Next recommended item to implement (first unchecked item)
5. Summarize overall progress across all phases

## Arguments

$ARGUMENTS — optional phase number (1, 2, or 3). Defaults to showing all phases.
