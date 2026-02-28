/**
 * WebSocket backend client.
 *
 * Connects to a WebSocket endpoint for real-time agent communication.
 * Handles connection lifecycle, auto-reconnect with exponential backoff,
 * request/response correlation, and push event handling.
 */

import type {
	AgentCommentsBackend,
	BackendConnectionStatus,
	BackendEventCallbacks,
} from "../models/backend";
import type { CommentThread, TextAnchor, ThreadMessage } from "../models/thread";
import {
	type ClientMessage,
	type ServerMessage,
	type NewThreadPayload,
	type NewMessagePayload,
	serializeClientMessage,
	deserializeServerMessage,
	validateServerPayload,
} from "./protocol";
import { generateId } from "../utils/ids";

const INITIAL_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 30000;
const REQUEST_TIMEOUT_MS = 30000;

interface PendingRequest {
	resolve: (payload: unknown) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

export class WebSocketBackend implements AgentCommentsBackend {
	private url: string;
	private ws: WebSocket | null = null;
	private _connectionStatus: BackendConnectionStatus = "disconnected";
	private reconnectMs = INITIAL_RECONNECT_MS;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private pendingRequests = new Map<string, PendingRequest>();
	private intentionalClose = false;

	// Callbacks
	private callbacks: Partial<BackendEventCallbacks> = {};

	get connectionStatus(): BackendConnectionStatus {
		return this._connectionStatus;
	}

	constructor(url: string) {
		if (!this.isValidWsUrl(url)) {
			throw new Error(`Invalid WebSocket URL: ${url}. Must use ws:// or wss:// scheme.`);
		}
		this.url = url;
	}

	async connect(): Promise<void> {
		if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
			return;
		}

		this.intentionalClose = false;
		this.setStatus("connecting");

		return new Promise<void>((resolve, reject) => {
			try {
				this.ws = new WebSocket(this.url);
			} catch (err) {
				this.setStatus("error");
				reject(err instanceof Error ? err : new Error(String(err)));
				return;
			}

			this.ws.onopen = () => {
				this.setStatus("connected");
				this.reconnectMs = INITIAL_RECONNECT_MS;
				resolve();
			};

			this.ws.onclose = () => {
				this.ws = null;
				if (!this.intentionalClose) {
					this.setStatus("connecting");
					this.scheduleReconnect();
				} else {
					this.setStatus("disconnected");
				}
			};

			this.ws.onerror = () => {
				// WebSocket errors are always followed by a close event.
				// We don't reject here — let onclose handle reconnect.
				if (this._connectionStatus === "connecting") {
					reject(new Error(`WebSocket connection failed: ${this.url}`));
				}
			};

			this.ws.onmessage = (event) => {
				this.handleMessage(String(event.data));
			};
		});
	}

	disconnect(): void {
		this.intentionalClose = true;
		if (this.reconnectTimer !== null) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}

		// Reject all pending requests
		for (const [, pending] of this.pendingRequests) {
			clearTimeout(pending.timer);
			pending.reject(new Error("WebSocket disconnected"));
		}
		this.pendingRequests.clear();

		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}

		this.setStatus("disconnected");
	}

	async createThread(anchor: TextAnchor, firstMessage?: ThreadMessage): Promise<CommentThread> {
		const payload = await this.sendRequest("createThread", { anchor, firstMessage });
		return (payload as { thread: CommentThread }).thread;
	}

	async addMessage(threadId: string, message: ThreadMessage): Promise<ThreadMessage> {
		const payload = await this.sendRequest("addMessage", { threadId, message });
		return (payload as { message: ThreadMessage }).message;
	}

	async resolveThread(threadId: string): Promise<void> {
		await this.sendRequest("resolveThread", { threadId });
	}

	async reopenThread(threadId: string): Promise<void> {
		await this.sendRequest("reopenThread", { threadId });
	}

	async acceptSuggestion(threadId: string, messageId: string): Promise<void> {
		await this.sendRequest("acceptSuggestion", { threadId, messageId });
	}

	async rejectSuggestion(threadId: string, messageId: string): Promise<void> {
		await this.sendRequest("rejectSuggestion", { threadId, messageId });
	}

	onNewThread(callback: (thread: CommentThread) => void): void {
		this.callbacks.onNewThread = callback;
	}

	onNewMessage(callback: (threadId: string, message: ThreadMessage) => void): void {
		this.callbacks.onNewMessage = callback;
	}

	onSuggestion(callback: (threadId: string, message: ThreadMessage) => void): void {
		this.callbacks.onSuggestion = callback;
	}

	private sendRequest(type: ClientMessage["type"], payload: unknown): Promise<unknown> {
		return new Promise((resolve, reject) => {
			if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
				reject(new Error("WebSocket is not connected"));
				return;
			}

			const requestId = generateId();
			const msg: ClientMessage = { type, requestId, payload };

			const timer = setTimeout(() => {
				this.pendingRequests.delete(requestId);
				reject(new Error(`Request '${type}' timed out after ${REQUEST_TIMEOUT_MS}ms`));
			}, REQUEST_TIMEOUT_MS);

			this.pendingRequests.set(requestId, { resolve, reject, timer });

			try {
				this.ws.send(serializeClientMessage(msg));
			} catch (err) {
				clearTimeout(timer);
				this.pendingRequests.delete(requestId);
				reject(err instanceof Error ? err : new Error(String(err)));
			}
		});
	}

	private handleMessage(raw: string): void {
		const msg = deserializeServerMessage(raw);
		if (!msg) {
			console.warn("[agent-comments] Received invalid WebSocket message, ignoring");
			return;
		}

		if (!validateServerPayload(msg)) {
			console.warn(`[agent-comments] Received malformed payload for type '${msg.type}', ignoring`);
			return;
		}

		// Check if this is a response to a pending request
		if (msg.requestId && this.pendingRequests.has(msg.requestId)) {
			const pending = this.pendingRequests.get(msg.requestId)!;
			this.pendingRequests.delete(msg.requestId);
			clearTimeout(pending.timer);

			if (msg.type === "error") {
				const errorPayload = msg.payload as { message: string };
				pending.reject(new Error(errorPayload.message));
			} else {
				pending.resolve(msg.payload);
			}
			return;
		}

		// Push events from server
		this.handlePushEvent(msg);
	}

	private handlePushEvent(msg: ServerMessage): void {
		const payload = msg.payload as Record<string, unknown>;

		switch (msg.type) {
			case "newThread": {
				const threadPayload = payload as unknown as NewThreadPayload;
				this.callbacks.onNewThread?.(threadPayload.thread);
				break;
			}
			case "newMessage":
			case "suggestion": {
				const msgPayload = payload as unknown as NewMessagePayload;
				if (msg.type === "suggestion") {
					this.callbacks.onSuggestion?.(msgPayload.threadId, msgPayload.message);
				} else {
					this.callbacks.onNewMessage?.(msgPayload.threadId, msgPayload.message);
				}
				break;
			}
			case "error": {
				const errorPayload = payload as { message: string };
				console.warn(`[agent-comments] Server error: ${errorPayload.message}`);
				break;
			}
			default:
				// Ignore unhandled push event types (forward compat)
				break;
		}
	}

	private scheduleReconnect(): void {
		if (this.intentionalClose) return;

		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			void this.connect().catch(() => {
				// Connection failed — onclose will trigger another reconnect
			});
		}, this.reconnectMs);

		// Exponential backoff: 1s, 2s, 4s, 8s, ..., max 30s
		this.reconnectMs = Math.min(this.reconnectMs * 2, MAX_RECONNECT_MS);
	}

	private setStatus(status: BackendConnectionStatus): void {
		this._connectionStatus = status;
	}

	private isValidWsUrl(url: string): boolean {
		try {
			const parsed = new URL(url);
			return parsed.protocol === "ws:" || parsed.protocol === "wss:";
		} catch {
			return false;
		}
	}
}
