# Build Plugin

Build the plugin and report any errors.

## Instructions

1. Run `npm run build` for a production build
2. If the build fails:
   - Read the error output carefully
   - Identify the source file(s) with errors
   - Fix TypeScript errors, import issues, or build configuration problems
   - Re-run the build to confirm the fix
3. If the build succeeds, report the output file size (`main.js`)
4. Optionally run `npm run lint` to check for lint issues

## Arguments

$ARGUMENTS — optional: "dev" for watch mode (`npm run dev`), "lint" to also run linting. Defaults to production build.
