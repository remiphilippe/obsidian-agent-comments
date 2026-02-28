# Run Tests

Run the test suite and report results.

## Instructions

1. Run `npm test` to execute the full test suite
2. If tests fail:
   - Read the failing test file(s)
   - Read the source file(s) being tested
   - Identify whether the failure is in the test or the source
   - Fix the issue
   - Re-run tests to confirm the fix
3. If $ARGUMENTS specifies a file or pattern, run only those tests: `npm test -- --grep "$ARGUMENTS"`

## Arguments

$ARGUMENTS — optional test file path or grep pattern. Defaults to running all tests.
