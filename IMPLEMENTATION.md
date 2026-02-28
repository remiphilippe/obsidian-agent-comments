# obsidian-agent-comments — Implementation Spec

**Repo:** `github.com/remiphilippe/obsidian-agent-comments`
**License:** MIT (open source)

---

## 1. Purpose

Bidirectional inline comment threads between humans and AI agents on markdown documents. Not "AI annotates, human approves" — it's a conversation anchored to text. Either side can start a thread, respond, suggest edits, or ask questions.

The plugin defines a **protocol, not a backend**. Any AI agent system can implement the backend interface. Communication is via configurable WebSocket or REST endpoint.

---

## 2. Data Model

### CommentThread

The fundamental unit is a `CommentThread`, not an individual annotation. A thread is a conversation anchored to a text range. Human and agent messages interleave freely.

```typescript
interface CommentThread {
  id: string;
  documentId: string;
  anchor: TextAnchor;
  status: 'open' | 'resolved';
  messages: ThreadMessage[];
  createdAt: string;   // ISO 8601
  updatedAt: string;   // ISO 8601
}
```

### TextAnchor

```typescript
interface TextAnchor {
  anchorText: string;       // the selected text (resilience across minor edits)
  startOffset: number;
  endOffset: number;
  sectionHeading?: string;  // nearest heading (additional fallback for re-anchoring)
}
```

### ThreadMessage

```typescript
interface ThreadMessage {
  id: string;
  author: string;            // "remi", "ResearchAgent", "WriterAgent", etc.
  authorType: 'human' | 'agent';
  content: string;
  timestamp: string;         // ISO 8601
  suggestion?: Suggestion;   // optional: any message can carry a text replacement
  knowledgeRefs?: string[];  // optional: opaque references for external plugins to render
}
```

### Suggestion

```typescript
interface Suggestion {
  originalText: string;
  replacementText: string;
  status: 'pending' | 'accepted' | 'rejected';
}
```

---

## 3. Backend Protocol

The plugin speaks this protocol. Any backend implements it. Communication: configurable WebSocket or REST endpoint.

```typescript
interface AgentCommentsBackend {
  // Thread lifecycle
  createThread(anchor: TextAnchor, firstMessage?: ThreadMessage): Promise<CommentThread>;
  addMessage(threadId: string, message: ThreadMessage): Promise<ThreadMessage>;
  resolveThread(threadId: string): Promise<void>;
  reopenThread(threadId: string): Promise<void>;

  // Suggestions (attached to any message in a thread)
  acceptSuggestion(threadId: string, messageId: string): Promise<void>;
  rejectSuggestion(threadId: string, messageId: string): Promise<void>;

  // Backend → Plugin (pushed via WebSocket)
  onNewThread(callback: (thread: CommentThread) => void): void;
  onNewMessage(callback: (threadId: string, message: ThreadMessage) => void): void;
  onSuggestion(callback: (threadId: string, message: ThreadMessage) => void): void;
}
```

### Backend Implementations

Any system can implement `AgentCommentsBackend` — a Go service with a WebSocket bridge, a Python server, a local LLM wrapper, or any custom agent framework. The plugin doesn't care what's behind the protocol.

---

## 4. Storage

Per-document sidecar `.agent-comments.json` files. Keeps markdown clean. Other tools see plain markdown. The plugin renders threads as CodeMirror 6 decorations.

### File naming convention

For a document `my-article.md`, the sidecar file is `my-article.agent-comments.json`.

### Sidecar file structure

```json
{
  "version": 1,
  "documentId": "path/to/my-article.md",
  "threads": [
    {
      "id": "thread-uuid-1",
      "documentId": "path/to/my-article.md",
      "anchor": {
        "anchorText": "the selected text passage",
        "startOffset": 1234,
        "endOffset": 1280,
        "sectionHeading": "## Results"
      },
      "status": "open",
      "messages": [
        {
          "id": "msg-uuid-1",
          "author": "remi",
          "authorType": "human",
          "content": "Can you verify this claim?",
          "timestamp": "2026-02-27T10:30:00Z"
        },
        {
          "id": "msg-uuid-2",
          "author": "ResearchAgent",
          "authorType": "agent",
          "content": "Found two comparable benchmarks...",
          "timestamp": "2026-02-27T10:31:15Z",
          "knowledgeRefs": ["research:autoGen-benchmark-2025"]
        }
      ],
      "createdAt": "2026-02-27T10:30:00Z",
      "updatedAt": "2026-02-27T10:31:15Z"
    }
  ]
}
```

---

## 5. UI Components

### 5.1 Thread Indicators (Editing Mode)

**CodeMirror 6 gutter decorations.** Lines with active threads show marks in the gutter. Click to expand the conversation in the sidebar.

### 5.2 Thread Indicators (Reading Mode)

**Margin badges.** Thread indicators appear as subtle badges in the margin. Click to expand.

### 5.3 Thread Panel (Right Sidebar)

A dedicated sidebar panel that shows:
- List of all threads for the current document (grouped by status: open / resolved)
- Thread detail view: full conversation, message composer, suggestion diffs
- Orphaned threads section: threads whose anchors broke due to document edits

### 5.4 Suggestion Diffs

Suggestions render as colored inline diffs:
- **Insertions:** green background
- **Deletions:** red background with strikethrough
- Accept/reject buttons per suggestion
- Bulk-resolve entire thread option

### 5.5 Context Menu

Right-click a heading → "Regenerate section" opens a thread pre-populated with the section context. WriterAgent responds with a suggestion.

### 5.6 Mobile / Tablet

- Comment panel collapses to **bottom sheet**
- Thread indicators are **subtle highlights**, tappable to expand
- Suggestion diffs render as simplified **accept/reject cards**

---

## 6. Features

### 6.1 Bidirectional Threads

Human or agent can start a thread on any text selection. Either side initiates:
- Human can tag a section and ask "strengthen this argument"
- Agent can open a thread on a weak claim and say "I couldn't find evidence for this — do you have a source, or should I rephrase?"

### 6.2 Suggestion Mode

Any message in a thread can carry a `Suggestion`. The suggestion contains `originalText` and `replacementText`. UI renders the diff inline. Accept applies the replacement to the document. Reject marks the suggestion as rejected and keeps the original text.

### 6.3 Section Regeneration

Right-click a heading → "Regenerate section" opens a thread pre-populated with the section context. The backend's WriterAgent responds with a suggestion containing the regenerated section.

### 6.4 Re-anchoring

When the document is edited, anchors are updated by matching:
1. Exact offset — if `documentContent.slice(startOffset, endOffset) === anchorText`, the anchor is still valid (fast path)
2. `anchorText` text search — find `anchorText` in document via `indexOf`, prefer match closest to original offset
3. `sectionHeading` fallback — find the heading in the document, search for `anchorText` near it

If all three layers fail (text deleted entirely), the thread moves to **"orphaned"** state and appears in a sidebar panel for manual re-attachment or dismissal.

**Performance:** All thread anchors are stored in an interval tree (`@flatten-js/interval-tree`) for O(log n) range queries. On document change, offset updates are applied via in-place anchor shifting and interval tree rebuild — the same approach validated by [obsidian-criticmarkup](https://github.com/Fevol/obsidian-criticmarkup). This avoids cascading recalculations and scales to hundreds of threads without degradation.

### 6.5 Orphaned Threads

Threads whose anchors can't be resolved appear in a dedicated "Orphaned" section of the sidebar. Users can:
- Manually re-attach to a new text selection
- Dismiss (delete) the orphaned thread
- Keep as orphaned (reference only)

### 6.6 Knowledge References (Extension Point)

`ThreadMessage.knowledgeRefs` is an opaque `string[]`. This plugin does **not** interpret them. External plugins (e.g., `obsidian-knowledge-store`) can register a `KnowledgeRefRenderer` callback via `registerKnowledgeRefProvider(prefix, renderer)`. Recognized refs render as interactive elements in the thread detail sidebar view. If no provider matches a prefix, the ref renders as a plain text badge. If no external plugin is installed, all refs render as plain text badges.

### 6.7 Offline Mode

The plugin is **offline-first**. The sidecar file is always the source of truth — not the backend. All human-initiated operations work without a network connection.

**Design:**

```
                          ┌──────────────┐
  Human action ──────────►│   Sidecar    │  (immediate, always works)
       │                  │   (.json)    │
       │                  └──────────────┘
       │                         │
       ▼                         ▼
  ┌──────────┐           ┌──────────────┐
  │  Outbox  │──(drain)─►│   Backend    │  (async, when connected)
  └──────────┘           └──────────────┘
       ▲                         │
       │                         ▼
  (queue if                ┌──────────────┐
   disconnected)           │  Agent msgs  │──► merge into sidecar
                           └──────────────┘
```

**Offline behavior by operation:**

| Operation | Offline behavior |
|-----------|-----------------|
| Create thread | Works. Written to sidecar. Queued in outbox for backend. |
| Add message (human) | Works. Written to sidecar. Queued in outbox. |
| Accept/reject suggestion | Works. Document modified, sidecar updated. Queued in outbox. |
| Resolve/reopen thread | Works. Sidecar updated. Queued in outbox. |
| Section regeneration | **Unavailable** — requires agent response. Command disabled with tooltip. |
| Agent creates thread | Received when connection resumes. Merged into sidecar. |
| Agent adds message | Received when connection resumes. Merged into sidecar. |

**Outbox:**

- In-memory FIFO queue of operations destined for the backend
- Each entry: `{ type, payload, timestamp, retryCount }`
- On reconnect: drain in order. If an operation fails (backend rejects), log warning and discard — sidecar state is truth.
- Outbox is volatile (lost on plugin unload). This is acceptable because the sidecar already has the data. The outbox only ensures the backend is notified. If notification is lost, the backend can reconcile from the sidecar on next full sync.

**Connection status indicator:**

- Sidebar header shows connection state: connected (green dot), connecting (yellow dot), disconnected (gray dot — initial state or intentional close), offline (gray dot — disconnected but functional via sidecar), error (red dot)
- "Offline" and "disconnected" are not errors — they are normal states. No disruptive notices on disconnect. A subtle indicator change is sufficient.
- On reconnect after extended offline: show a `Notice` once: "Reconnected — syncing N pending operations"

**Merge strategy for incoming backend messages:**

When the backend pushes a message (agent response) after reconnection:
1. Check if the thread ID exists in sidecar — if yes, append the message
2. Check if the message ID already exists (duplicate) — if yes, skip
3. If the thread ID doesn't exist (agent created a new thread while offline) — add the full thread to sidecar
4. Re-anchor any new threads against current document content

---

## 7. Example Thread Flow

> **Remi** (selects paragraph 3): "This claim about 902 turns being unprecedented — can you verify?"
> **ResearchAgent**: "Found two comparable benchmarks. AutoGen reported 340 turns in their longest documented run. CrewAI's benchmark suite topped out at ~500. Your 902 is the highest I can find in public literature." `[knowledgeRefs: ["research:autoGen-benchmark-2025", "research:crewai-bench"]]`
> **Remi**: "Good. Add the comparison but don't make it sound like bragging."
> **WriterAgent**: `[suggestion: replace paragraph 3 with contextualized comparison]`
> **Remi**: ✓ accepts suggestion → thread resolved

---

## 8. Implementation Phases (Plugin-Specific)

### Phase 1: Foundation

- [ ] Public repo scaffold: MIT license, TypeScript, Obsidian sample plugin template
- [ ] `CommentThread` data model (TypeScript interfaces)
- [ ] Sidecar `.agent-comments.json` file read/write
- [ ] `AgentCommentsBackend` protocol interface
- [ ] Settings UI: backend endpoint configuration (WebSocket URL, REST URL)
- [ ] Local-only backend (no network, threads stored in sidecar files only)

### Phase 2: MVP

- [ ] Bidirectional thread creation (human → agent, agent → human)
- [ ] CodeMirror 6 gutter decorations (editing mode)
- [ ] Thread panel in right sidebar
- [ ] Suggestion diffs with accept/reject
- [ ] Re-anchoring on document edits
- [ ] Orphaned thread management
- [ ] WebSocket backend connection
- [ ] Offline mode: outbox queue, merge on reconnect, connection status indicator
- [ ] Mobile testing

### Phase 3: Polish

- [ ] Reading mode margin badges
- [ ] Section regeneration (right-click context menu)
- [ ] Bulk thread resolve
- [ ] Thread filtering and search
- [ ] `knowledgeRefs` extension point (decoration provider registration API)
- [ ] Performance optimization for documents with many threads

---

## 9. Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Storage format | Sidecar `.agent-comments.json` | Keeps markdown clean. Other tools see plain markdown. CriticMarkup stores inline and acknowledges data loss risk — sidecar eliminates that entire class of bugs. |
| UI rendering | CodeMirror 6 decorations | Native Obsidian editor integration. Performant. Supports gutter marks, inline diffs, widgets. |
| CM6 state architecture | StateField for data, ViewPlugin for DOM, Compartment for toggles | Proven pattern from obsidian-criticmarkup. StateField is immutable/transactional for thread data. ViewPlugin handles DOM layout. Compartments allow reconfiguring features (resolved visibility, preview modes) without rebuilding extensions. |
| Range management | `@flatten-js/interval-tree` | O(log n) range queries and offset updates. CriticMarkup validates this approach — critical for performance on large documents with many threads. |
| Backend coupling | Protocol interface | Plugin is backend-agnostic. Anyone can implement `AgentCommentsBackend`. |
| Communication | WebSocket + REST | WebSocket for push (backend → plugin). REST fallback for request/response. |
| Anchor resilience | Text + offset + heading | Triple-layer anchoring: exact offset (fast), anchor text match (survives minor edits), section heading (survives refactors). |
| Thread identity | Stable UUIDs in sidecar | CriticMarkup reconstructs threads by adjacency after each parse — fragile, causes duplication bugs. Our threads have stable IDs, independent of parse order. |
| Widget lifecycle | Cache via `eq()` override | CriticMarkup destroys/recreates comment widgets on every selection change. Override `WidgetType.eq()` to prevent unnecessary DOM churn. |
| Diff algorithm | `diff-match-patch` library | Proven semantic diff used by CriticMarkup and Google. Small dependency (~6KB), no runtime deps of its own. |
| Offline mode | Sidecar is source of truth, backend notified async | All human operations work offline. Outbox queues backend notifications. Backend pushes merge into sidecar on reconnect. No features disabled except section regeneration (requires agent). |
| Knowledge refs | Opaque `string[]` | No coupling to specific knowledge store implementations. Extension point only. |
| Thread model | Conversation threads, not flat annotations | Threads are conversations. Multiple messages, back-and-forth, context preserved. |

---

## 10. Integration Points

### With `obsidian-knowledge-store` (closed source, separate repo)

The knowledge store plugin hooks into agent-comments via:

1. **`knowledgeRefs` rendering** — Registers a CM6 decoration provider that renders recognized refs as expandable reference cards (source, collection, snippet). Clicking opens the full entry in the knowledge store sidebar.

2. **"Find related" in thread context** — When composing a message in a comment thread, a button/command searches the knowledge store for content related to the thread's anchor text. Results appear inline in the thread composer.

3. **Agent-inserted references** — When agents respond with knowledge references, the knowledge store plugin makes them clickable and browsable. Human can verify agent sources without leaving the thread.

**Coupling is one-way:** Knowledge store depends on agent-comments, not the reverse. The `knowledgeRefs` field is opaque — if knowledge-store isn't installed, refs are ignored.

### With Custom Backends

Anyone implements the `AgentCommentsBackend` interface. The plugin doesn't care what's behind the protocol — could be a Go service with a message bus, a Python server, a local LLM, a cloud API, or a custom agent framework.

---

## 11. Risks & Mitigations (Plugin-Specific)

| Risk | Mitigation |
|------|------------|
| CodeMirror 6 decoration complexity | Phase 2 MVP is minimal: gutter marks + sidebar panel. Rich inline rendering is iterative. |
| Sidecar anchor resilience | Triple-layer anchoring (offset + anchorText + sectionHeading) backed by interval tree. Orphaned threads surface in sidebar for manual resolution. |
| Suggestion acceptance corrupts document | Validate `originalText` matches current content at anchor position before applying. Single atomic transaction. Re-anchor all threads after offset shift. Never apply blindly. (CriticMarkup issues #3, #13, #14) |
| Gutter conflicts with Obsidian settings | Test with "Show line numbers" enabled (CriticMarkup #24). Verify gutter does not reduce readable line width (CriticMarkup #31). Scope gutter CSS to markdown views only — do not affect Canvas/Kanban (#21). |
| Plugin initialization crash on fresh install | Use `workspace.onLayoutReady()` for deferred editor access. Never access StateFields before registration. (CriticMarkup #16, #18) |
| Other plugin conflicts | Never intercept editor transactions. Our StateField observes read-only. No transaction filters = no conflicts with autocomplete, wikilinks, Vim mode. (CriticMarkup #25, #34, #37, #39) |
| Widget DOM churn on scroll/selection | Override `WidgetType.eq()` on all custom widgets. Only recreate DOM when underlying thread data changes. |
| Backend divergence from plugin changes | Protocol interface is the contract. Backend adapters don't depend on plugin internals. Keep protocol backward-compatible. |
| Knowledge store coupling | One-way coupling via opaque `knowledgeRefs`. Low surface area for breakage. |
| Mobile rendering constraints | Bottom sheet + simplified cards. Progressive enhancement, not feature parity. |

## 12. Prior Art

### [Fevol/obsidian-criticmarkup](https://github.com/Fevol/obsidian-criticmarkup)

CriticMarkup-based commenting and suggestion tracking. Beta for 2+ years with data loss warning. 43 issues filed.

**What they got right:** Interval tree for range management, Compartment for feature toggles, StateField/ViewPlugin separation, rich gutter implementation.

**What went wrong:** Inline storage causes data loss (issues #3, #13, #14, #27). Transaction filter for suggestion mode breaks wikilinks (#34, #37), Vim mode (#39), autocomplete (#25), multi-cursor (#38), and IME input (#36). Comment threads reconstructed by adjacency after every parse — fragile, causes duplication bugs. Widgets destroyed on every selection change. Gutter CSS leaks into Canvas/Kanban views (#21). Fresh install crashes (#16, #18). Users can't tell if "Add Comment" worked (#35, #43).

**Why our architecture avoids these:** Sidecar storage (no inline corruption risk), no transaction interception (no plugin conflicts), stable thread UUIDs (no reconstruction bugs), scoped CSS (no view leakage), deferred initialization (no crash on fresh install), immediate visual feedback on thread creation (gutter dot + sidebar scroll).
