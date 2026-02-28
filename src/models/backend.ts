/**
 * Backend protocol interface.
 * Matches IMPLEMENTATION.md section 3 exactly.
 *
 * The plugin is backend-agnostic. Any AI agent system can implement
 * this interface via WebSocket, REST, or locally.
 */

import type { CommentThread, TextAnchor, ThreadMessage } from "./thread";

/**
 * Connection status for backend implementations.
 * 'offline' is distinct from 'disconnected': it means
 * "disconnected but fully functional via sidecar".
 */
export type BackendConnectionStatus =
	| "disconnected"
	| "connecting"
	| "connected"
	| "offline"
	| "error";

/**
 * Callbacks for push events from backend to plugin.
 */
export interface BackendEventCallbacks {
	onNewThread: (thread: CommentThread) => void;
	onNewMessage: (threadId: string, message: ThreadMessage) => void;
	onSuggestion: (threadId: string, message: ThreadMessage) => void;
}

/**
 * The core backend protocol interface.
 * Every backend (local, WebSocket, REST) implements this.
 */
export interface AgentCommentsBackend {
	// Thread lifecycle
	createThread(anchor: TextAnchor, firstMessage?: ThreadMessage): Promise<CommentThread>;
	addMessage(threadId: string, message: ThreadMessage): Promise<ThreadMessage>;
	resolveThread(threadId: string): Promise<void>;
	reopenThread(threadId: string): Promise<void>;

	// Suggestions (attached to any message in a thread)
	acceptSuggestion(threadId: string, messageId: string): Promise<void>;
	rejectSuggestion(threadId: string, messageId: string): Promise<void>;

	// Backend → Plugin (pushed via WebSocket or polled via REST)
	onNewThread(callback: (thread: CommentThread) => void): void;
	onNewMessage(callback: (threadId: string, message: ThreadMessage) => void): void;
	onSuggestion(callback: (threadId: string, message: ThreadMessage) => void): void;

	// Connection management
	readonly connectionStatus: BackendConnectionStatus;
	connect?(): Promise<void>;
	disconnect?(): void;
}
