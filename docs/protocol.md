# Backend Protocol

Agent Comments communicates with AI agent backends via the `AgentCommentsBackend` interface. Any backend can implement this protocol using WebSocket or REST.

## Interface

```typescript
interface AgentCommentsBackend {
  // Thread lifecycle
  createThread(anchor: TextAnchor, firstMessage?: ThreadMessage): Promise<CommentThread>;
  addMessage(threadId: string, message: ThreadMessage): Promise<ThreadMessage>;
  resolveThread(threadId: string): Promise<void>;
  reopenThread(threadId: string): Promise<void>;

  // Suggestions
  acceptSuggestion(threadId: string, messageId: string): Promise<void>;
  rejectSuggestion(threadId: string, messageId: string): Promise<void>;

  // Push events (server → plugin)
  onNewThread(callback: (thread: CommentThread) => void): void;
  onNewMessage(callback: (threadId: string, message: ThreadMessage) => void): void;
  onSuggestion(callback: (threadId: string, message: ThreadMessage) => void): void;

  // Connection
  readonly connectionStatus: BackendConnectionStatus;
  connect?(): Promise<void>;
  disconnect?(): void;
}
```

## Data model

### TextAnchor

```json
{
  "anchorText": "the selected text",
  "startOffset": 42,
  "endOffset": 60,
  "sectionHeading": "## Results"
}
```

### CommentThread

```json
{
  "id": "uuid",
  "documentId": "path/to/file.md",
  "anchor": { ... },
  "status": "open",
  "messages": [ ... ],
  "createdAt": "2026-01-15T10:00:00Z",
  "updatedAt": "2026-01-15T10:05:00Z"
}
```

### ThreadMessage

```json
{
  "id": "uuid",
  "author": "WriterAgent",
  "authorType": "agent",
  "content": "Here is my suggestion",
  "timestamp": "2026-01-15T10:02:00Z",
  "suggestion": {
    "originalText": "old text",
    "replacementText": "new text",
    "status": "pending"
  },
  "knowledgeRefs": ["research:paper-123"]
}
```

## WebSocket wire format

All messages are JSON strings sent over a WebSocket connection (`ws://` or `wss://`).

### Client to server

```json
{
  "type": "createThread",
  "requestId": "uuid",
  "payload": {
    "anchor": { "anchorText": "...", "startOffset": 0, "endOffset": 10 },
    "firstMessage": { "id": "...", "author": "...", "content": "..." }
  }
}
```

**Message types:**

| Type | Payload |
|------|---------|
| `createThread` | `{ anchor: TextAnchor, firstMessage?: ThreadMessage }` |
| `addMessage` | `{ threadId: string, message: ThreadMessage }` |
| `resolveThread` | `{ threadId: string }` |
| `reopenThread` | `{ threadId: string }` |
| `acceptSuggestion` | `{ threadId: string, messageId: string }` |
| `rejectSuggestion` | `{ threadId: string, messageId: string }` |

### Server to client

**Responses** (correlated by `requestId`):

| Type | Payload |
|------|---------|
| `threadCreated` | `{ thread: CommentThread }` |
| `messageAdded` | `{ threadId: string, message: ThreadMessage }` |
| `threadResolved` | `{}` |
| `threadReopened` | `{}` |
| `suggestionAccepted` | `{}` |
| `suggestionRejected` | `{}` |
| `error` | `{ message: string, code?: string }` |

**Push events** (no `requestId`):

| Type | Payload |
|------|---------|
| `newThread` | `{ thread: CommentThread }` |
| `newMessage` | `{ threadId: string, message: ThreadMessage }` |
| `suggestion` | `{ threadId: string, message: ThreadMessage }` |

### Connection behavior

- The plugin connects with exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
- Requests time out after 30 seconds
- Pending requests are rejected on disconnect
- Intentional `disconnect()` does not trigger reconnection

## REST endpoints

For REST backends, the plugin makes HTTP requests:

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/threads` | `{ anchor, firstMessage }` | `CommentThread` |
| POST | `/threads/:id/messages` | `{ message }` | `ThreadMessage` |
| POST | `/threads/:id/resolve` | — | `void` |
| POST | `/threads/:id/reopen` | — | `void` |
| POST | `/threads/:id/messages/:msgId/accept` | — | `void` |
| POST | `/threads/:id/messages/:msgId/reject` | — | `void` |

REST backends do not support push events. Use WebSocket for real-time collaboration.

## Implementing a custom backend

### Minimal echo backend (Node.js)

```javascript
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 8080 });

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    const { type, requestId, payload } = msg;

    switch (type) {
      case 'createThread': {
        const thread = {
          id: crypto.randomUUID(),
          documentId: 'unknown',
          anchor: payload.anchor,
          status: 'open',
          messages: [payload.firstMessage],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        // Send response
        ws.send(JSON.stringify({
          type: 'threadCreated',
          requestId,
          payload: { thread },
        }));

        // Echo back an agent reply after 1 second
        setTimeout(() => {
          const reply = {
            id: crypto.randomUUID(),
            author: 'EchoBot',
            authorType: 'agent',
            content: `You said: "${payload.firstMessage.content}"`,
            timestamp: new Date().toISOString(),
          };

          ws.send(JSON.stringify({
            type: 'newMessage',
            payload: { threadId: thread.id, message: reply },
          }));
        }, 1000);
        break;
      }

      case 'addMessage':
        ws.send(JSON.stringify({
          type: 'messageAdded',
          requestId,
          payload: {
            threadId: payload.threadId,
            message: payload.message,
          },
        }));
        break;

      case 'resolveThread':
        ws.send(JSON.stringify({
          type: 'threadResolved',
          requestId,
          payload: {},
        }));
        break;

      case 'reopenThread':
        ws.send(JSON.stringify({
          type: 'threadReopened',
          requestId,
          payload: {},
        }));
        break;

      default:
        ws.send(JSON.stringify({
          type: 'error',
          requestId,
          payload: { message: `Unknown message type: ${type}` },
        }));
    }
  });
});

console.log('Echo backend listening on ws://localhost:8080');
```

### Step by step

1. Set up a WebSocket server on any port
2. Parse incoming JSON messages with `type`, `requestId`, and `payload`
3. For each client request, send a response with the matching `requestId`
4. To push updates to the client, send messages without `requestId`
5. Store threads however you like — the plugin always has its own sidecar copy

### Validation

The plugin validates all incoming server messages:
- `type` must be one of the defined server message types
- `requestId` must be a string if present
- `payload` must exist
- Payload structure is validated per message type
- Unknown message types are ignored with a console warning
- Malformed JSON is ignored with a console warning
