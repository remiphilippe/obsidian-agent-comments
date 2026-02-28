/**
 * REST backend client.
 *
 * Uses fetch() for request/response communication with agent backends.
 * No push support — onNewThread/onNewMessage/onSuggestion are no-ops
 * with console warnings. For polling-based backends, use poll().
 */

import type {
	AgentCommentsBackend,
	BackendConnectionStatus,
} from "../models/backend";
import type { CommentThread, TextAnchor, ThreadMessage } from "../models/thread";

const REQUEST_TIMEOUT_MS = 30000;

export class RestBackend implements AgentCommentsBackend {
	private baseUrl: string;
	private _connectionStatus: BackendConnectionStatus = "disconnected";
	private pollTimer: ReturnType<typeof setTimeout> | null = null;

	get connectionStatus(): BackendConnectionStatus {
		return this._connectionStatus;
	}

	constructor(url: string) {
		if (!this.isValidHttpUrl(url)) {
			throw new Error(`Invalid REST URL: ${url}. Must use http:// or https:// scheme.`);
		}
		// Strip trailing slash
		this.baseUrl = url.replace(/\/+$/, "");
	}

	async connect(): Promise<void> {
		this._connectionStatus = "connecting";
		try {
			// Health check — verify the backend is reachable
			const response = await this.fetch("GET", "/health");
			if (response.ok) {
				this._connectionStatus = "connected";
			} else {
				this._connectionStatus = "error";
			}
		} catch {
			this._connectionStatus = "error";
		}
	}

	disconnect(): void {
		if (this.pollTimer !== null) {
			clearTimeout(this.pollTimer);
			this.pollTimer = null;
		}
		this._connectionStatus = "disconnected";
	}

	async createThread(anchor: TextAnchor, firstMessage?: ThreadMessage): Promise<CommentThread> {
		const response = await this.fetch("POST", "/threads", { anchor, firstMessage });
		if (!response.ok) {
			throw new Error(`Failed to create thread: ${response.statusText}`);
		}
		const data = await response.json() as { thread: CommentThread };
		return data.thread;
	}

	async addMessage(threadId: string, message: ThreadMessage): Promise<ThreadMessage> {
		const response = await this.fetch("POST", `/threads/${encodeURIComponent(threadId)}/messages`, { message });
		if (!response.ok) {
			throw new Error(`Failed to add message: ${response.statusText}`);
		}
		const data = await response.json() as { message: ThreadMessage };
		return data.message;
	}

	async resolveThread(threadId: string): Promise<void> {
		const response = await this.fetch("PUT", `/threads/${encodeURIComponent(threadId)}/resolve`);
		if (!response.ok) {
			throw new Error(`Failed to resolve thread: ${response.statusText}`);
		}
	}

	async reopenThread(threadId: string): Promise<void> {
		const response = await this.fetch("PUT", `/threads/${encodeURIComponent(threadId)}/reopen`);
		if (!response.ok) {
			throw new Error(`Failed to reopen thread: ${response.statusText}`);
		}
	}

	async acceptSuggestion(threadId: string, messageId: string): Promise<void> {
		const response = await this.fetch(
			"PUT",
			`/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}/accept`,
		);
		if (!response.ok) {
			throw new Error(`Failed to accept suggestion: ${response.statusText}`);
		}
	}

	async rejectSuggestion(threadId: string, messageId: string): Promise<void> {
		const response = await this.fetch(
			"PUT",
			`/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}/reject`,
		);
		if (!response.ok) {
			throw new Error(`Failed to reject suggestion: ${response.statusText}`);
		}
	}

	// Push events are not available via REST — log warning
	onNewThread(_callback: (thread: CommentThread) => void): void {
		console.warn("[agent-comments] REST backend does not support push events for onNewThread. Use WebSocket backend for real-time updates.");
	}

	onNewMessage(_callback: (threadId: string, message: ThreadMessage) => void): void {
		console.warn("[agent-comments] REST backend does not support push events for onNewMessage. Use WebSocket backend for real-time updates.");
	}

	onSuggestion(_callback: (threadId: string, message: ThreadMessage) => void): void {
		console.warn("[agent-comments] REST backend does not support push events for onSuggestion. Use WebSocket backend for real-time updates.");
	}

	/**
	 * Optional polling for REST backends that don't support push.
	 * Periodically fetches thread state for the given document.
	 */
	startPolling(documentId: string, intervalMs: number, onUpdate: (threads: CommentThread[]) => void): void {
		this.stopPolling();

		const poll = async (): Promise<void> => {
			try {
				const response = await this.fetch("GET", `/threads?documentId=${encodeURIComponent(documentId)}`);
				if (response.ok) {
					const data = await response.json() as { threads: CommentThread[] };
					onUpdate(data.threads);
				}
			} catch {
				// Polling failure is non-fatal — will retry on next interval
			}
			this.pollTimer = setTimeout(() => void poll(), intervalMs);
		};

		void poll();
	}

	stopPolling(): void {
		if (this.pollTimer !== null) {
			clearTimeout(this.pollTimer);
			this.pollTimer = null;
		}
	}

	private async fetch(method: string, path: string, body?: unknown): Promise<Response> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

		try {
			const options: RequestInit = {
				method,
				headers: { "Content-Type": "application/json" },
				signal: controller.signal,
			};

			if (body !== undefined) {
				options.body = JSON.stringify(body);
			}

			const response = await globalThis.fetch(`${this.baseUrl}${path}`, options);

			// Update connection status based on response
			if (response.ok || response.status < 500) {
				this._connectionStatus = "connected";
			} else {
				this._connectionStatus = "error";
			}

			return response;
		} catch (err) {
			if (err instanceof DOMException && err.name === "AbortError") {
				this._connectionStatus = "error";
				throw new Error(`Request to ${path} timed out after ${REQUEST_TIMEOUT_MS}ms`);
			}
			this._connectionStatus = "error";
			throw err;
		} finally {
			clearTimeout(timer);
		}
	}

	private isValidHttpUrl(url: string): boolean {
		try {
			const parsed = new URL(url);
			return parsed.protocol === "http:" || parsed.protocol === "https:";
		} catch {
			return false;
		}
	}
}
