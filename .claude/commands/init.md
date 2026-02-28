# Initialize Project

Bootstrap the obsidian-agent-comments project from scratch.

## Instructions

1. Read `CLAUDE.md` for the project structure
2. Read `IMPLEMENTATION.md` for the data model

3. Create `package.json` with:
   - name: `obsidian-agent-comments`
   - description: "Bidirectional inline comment threads between humans and AI agents"
   - scripts: dev, build, test, lint
   - devDependencies: obsidian, @types/node, typescript, esbuild, vitest, eslint, prettier
   - Set `"type": "module"`

4. Create `manifest.json` for Obsidian:
   - id: `agent-comments`
   - name: `Agent Comments`
   - description: "Bidirectional inline comment threads between humans and AI agents"
   - minAppVersion: `1.4.0`
   - version: `0.1.0`

5. Create `tsconfig.json`:
   - strict: true
   - target: ES2022
   - module: ESNext
   - moduleResolution: bundler
   - types: ["node"]
   - outDir: dist

6. Create `esbuild.config.mjs` following Obsidian sample plugin pattern

7. Create `src/main.ts` with a minimal Plugin class

8. Create `src/models/thread.ts` with all data model interfaces from IMPLEMENTATION.md

9. Create `src/models/backend.ts` with the `AgentCommentsBackend` interface

10. Create `styles.css` with a placeholder comment

11. Create `.gitignore` for node_modules, dist, main.js (build output)

12. Run `npm install`

13. Run `npm run build` to verify everything compiles

14. Create initial `versions.json` mapping plugin version to minimum Obsidian version

## Arguments

$ARGUMENTS — not used. This command takes no arguments.
