/**
 * Offline-first backend wrapper.
 *
 * Wraps any AgentCommentsBackend (WebSocket or REST) to ensure
 * sidecar-first writes and offline resilience. All human-initiated
 * operations write to sidecar immediately, then forward to the
 * wrapped backend. If disconnected, operations queue in an outbox
 * and drain on reconnect.
 *
 * LocalBackend is NOT wrapped — it already writes directly to sidecar.
 */

import { Notice, TFile, Vault } from "obsidian";
import type {
	AgentCommentsBackend,
	BackendConnectionStatus,
} from "../models/backend";
import type { CommentThread, TextAnchor, ThreadMessage } from "../models/thread";
import { createThread as createThreadModel } from "../models/thread";
import { SidecarStorage } from "../storage/sidecar";
import { AnchorIndex, resolveAnchor } from "../storage/anchor";
import { nowISO } from "../utils/ids";

const MAX_RETRY_COUNT = 3;

export interface OutboxEntry {
	type: string;
	payload: unknown;
	timestamp: string;
	retryCount: number;
}

export class OfflineAwareBackend implements AgentCommentsBackend {
	private wrapped: AgentCommentsBackend;
	private storage: SidecarStorage;
	private vault: Vault;
	private outbox: OutboxEntry[] = [];
	private activeFile: TFile | null = null;
	private threads: CommentThread[] = [];
	private anchorIndex = new AnchorIndex();
	private draining = false;

	// Callbacks
	private onNewThreadCallback: ((thread: CommentThread) => void) | null = null;
	private onNewMessageCallback: ((threadId: string, message: ThreadMessage) => void) | null = null;
	private onSuggestionCallback: ((threadId: string, message: ThreadMessage) => void) | null = null;

	get connectionStatus(): BackendConnectionStatus {
		const innerStatus = this.wrapped.connectionStatus;
		// If inner backend is disconnected but we're functional via sidecar, report "offline"
		if (innerStatus === "disconnected" || innerStatus === "connecting") {
			return "offline";
		}
		return innerStatus;
	}

	constructor(wrapped: AgentCommentsBackend, storage: SidecarStorage, vault: Vault) {
		this.wrapped = wrapped;
		this.storage = storage;
		this.vault = vault;

		// Register push event handlers on the wrapped backend
		this.wrapped.onNewThread((thread) => this.handleIncomingThread(thread));
		this.wrapped.onNewMessage((threadId, message) => this.handleIncomingMessage(threadId, message));
		this.wrapped.onSuggestion((threadId, message) => this.handleIncomingSuggestion(threadId, message));
	}

	async setActiveDocument(file: TFile): Promise<void> {
		this.activeFile = file;
		this.threads = await this.storage.load(file);
		this.anchorIndex.build(this.threads);
	}

	getThreads(): CommentThread[] {
		return this.threads;
	}

	async connect(): Promise<void> {
		if (this.wrapped.connect) {
			try {
				await this.wrapped.connect();
				// Connection succeeded — drain outbox
				void this.drainOutbox();
			} catch {
				// Connection failed — still functional via sidecar
			}
		}
	}

	disconnect(): void {
		this.wrapped.disconnect?.();
	}

	/**
	 * Get the current outbox entries (for testing/diagnostics).
	 */
	getOutbox(): readonly OutboxEntry[] {
		return this.outbox;
	}

	/**
	 * Clear the outbox (called on plugin unload).
	 */
	clearOutbox(): void {
		this.outbox = [];
	}

	async createThread(anchor: TextAnchor, firstMessage?: ThreadMessage): Promise<CommentThread> {
		this.ensureActiveFile();

		// Write to sidecar FIRST
		const thread = createThreadModel({
			documentId: this.activeFile!.path,
			anchor,
			firstMessage,
		});

		this.threads.push(thread);
		this.anchorIndex.build(this.threads);
		await this.storage.saveImmediate(this.activeFile!, this.threads);

		this.onNewThreadCallback?.(thread);

		// Forward to backend (or queue)
		if (this.isConnected()) {
			try {
				await this.wrapped.createThread(anchor, firstMessage);
			} catch (err) {
				console.warn("[agent-comments] Backend createThread failed, queued in outbox:", err);
				this.enqueue("createThread", { anchor, firstMessage });
			}
		} else {
			this.enqueue("createThread", { anchor, firstMessage });
		}

		return thread;
	}

	async addMessage(threadId: string, message: ThreadMessage): Promise<ThreadMessage> {
		this.ensureActiveFile();

		// Write to sidecar FIRST
		const thread = this.findThread(threadId);
		thread.messages.push(message);
		thread.updatedAt = nowISO();
		await this.storage.saveImmediate(this.activeFile!, this.threads);

		this.onNewMessageCallback?.(threadId, message);

		// Forward to backend (or queue)
		if (this.isConnected()) {
			try {
				await this.wrapped.addMessage(threadId, message);
			} catch (err) {
				console.warn("[agent-comments] Backend addMessage failed, queued in outbox:", err);
				this.enqueue("addMessage", { threadId, message });
			}
		} else {
			this.enqueue("addMessage", { threadId, message });
		}

		return message;
	}

	async resolveThread(threadId: string): Promise<void> {
		this.ensureActiveFile();

		// Write to sidecar FIRST
		const thread = this.findThread(threadId);
		thread.status = "resolved";
		thread.updatedAt = nowISO();
		await this.storage.saveImmediate(this.activeFile!, this.threads);

		// Forward to backend (or queue)
		if (this.isConnected()) {
			try {
				await this.wrapped.resolveThread(threadId);
			} catch (err) {
				console.warn("[agent-comments] Backend resolveThread failed, queued in outbox:", err);
				this.enqueue("resolveThread", { threadId });
			}
		} else {
			this.enqueue("resolveThread", { threadId });
		}
	}

	async reopenThread(threadId: string): Promise<void> {
		this.ensureActiveFile();

		// Write to sidecar FIRST
		const thread = this.findThread(threadId);
		thread.status = "open";
		thread.updatedAt = nowISO();
		await this.storage.saveImmediate(this.activeFile!, this.threads);

		// Forward to backend (or queue)
		if (this.isConnected()) {
			try {
				await this.wrapped.reopenThread(threadId);
			} catch (err) {
				console.warn("[agent-comments] Backend reopenThread failed, queued in outbox:", err);
				this.enqueue("reopenThread", { threadId });
			}
		} else {
			this.enqueue("reopenThread", { threadId });
		}
	}

	async acceptSuggestion(threadId: string, messageId: string): Promise<void> {
		this.ensureActiveFile();

		// Find the suggestion
		const thread = this.findThread(threadId);
		const message = this.findMessage(thread, messageId);

		if (!message.suggestion) {
			throw new Error(`Message '${messageId}' has no suggestion`);
		}
		if (message.suggestion.status !== "pending") {
			throw new Error(`Suggestion in message '${messageId}' is already '${message.suggestion.status}'`);
		}

		// Read current document content
		const content = await this.vault.read(this.activeFile!);
		const { originalText, replacementText } = message.suggestion;

		// Validate originalText exists within the anchor range
		const { startOffset, endOffset } = thread.anchor;
		const currentText = content.slice(startOffset, endOffset);

		if (!currentText.includes(originalText)) {
			throw new Error("Original text not found at anchor position. The document may have changed since the suggestion was made.");
		}

		const localIdx = currentText.indexOf(originalText);
		const replaceStart = startOffset + localIdx;
		const replaceEnd = replaceStart + originalText.length;

		// Apply replacement atomically
		const newContent = content.slice(0, replaceStart) + replacementText + content.slice(replaceEnd);
		await this.vault.modify(this.activeFile!, newContent);

		// Re-anchor all other threads
		const delta = replacementText.length - originalText.length;
		if (delta !== 0) {
			this.anchorIndex.applyOffsetShift(replaceStart, replaceEnd, replacementText.length);
		}

		// Update suggestion status
		message.suggestion.status = "accepted";
		thread.updatedAt = nowISO();

		// Save sidecar
		await this.storage.saveImmediate(this.activeFile!, this.threads);

		// Forward to backend (or queue)
		if (this.isConnected()) {
			try {
				await this.wrapped.acceptSuggestion(threadId, messageId);
			} catch (err) {
				console.warn("[agent-comments] Backend acceptSuggestion failed, queued in outbox:", err);
				this.enqueue("acceptSuggestion", { threadId, messageId });
			}
		} else {
			this.enqueue("acceptSuggestion", { threadId, messageId });
		}
	}

	async rejectSuggestion(threadId: string, messageId: string): Promise<void> {
		this.ensureActiveFile();

		// Write to sidecar FIRST
		const thread = this.findThread(threadId);
		const message = this.findMessage(thread, messageId);

		if (!message.suggestion) {
			throw new Error(`Message '${messageId}' has no suggestion`);
		}
		if (message.suggestion.status !== "pending") {
			throw new Error(`Suggestion in message '${messageId}' is already '${message.suggestion.status}'`);
		}

		message.suggestion.status = "rejected";
		thread.updatedAt = nowISO();
		await this.storage.saveImmediate(this.activeFile!, this.threads);

		// Forward to backend (or queue)
		if (this.isConnected()) {
			try {
				await this.wrapped.rejectSuggestion(threadId, messageId);
			} catch (err) {
				console.warn("[agent-comments] Backend rejectSuggestion failed, queued in outbox:", err);
				this.enqueue("rejectSuggestion", { threadId, messageId });
			}
		} else {
			this.enqueue("rejectSuggestion", { threadId, messageId });
		}
	}

	onNewThread(callback: (thread: CommentThread) => void): void {
		this.onNewThreadCallback = callback;
	}

	onNewMessage(callback: (threadId: string, message: ThreadMessage) => void): void {
		this.onNewMessageCallback = callback;
	}

	onSuggestion(callback: (threadId: string, message: ThreadMessage) => void): void {
		this.onSuggestionCallback = callback;
	}

	// --- Push event handlers (backend → plugin) ---

	private handleIncomingThread(thread: CommentThread): void {
		// Check if thread ID already exists (skip duplicates)
		if (this.threads.some((t) => t.id === thread.id)) {
			return;
		}

		// Re-anchor against current document content (spec 6.7 merge step 4)
		if (this.activeFile) {
			void this.reanchorAndAddThread(thread);
		} else {
			this.threads.push(thread);
			this.anchorIndex.build(this.threads);
			this.onNewThreadCallback?.(thread);
		}
	}

	private async reanchorAndAddThread(thread: CommentThread): Promise<void> {
		try {
			const content = await this.vault.read(this.activeFile!);
			const resolved = resolveAnchor(thread.anchor, content);
			if (resolved) {
				thread.anchor.startOffset = resolved.startOffset;
				thread.anchor.endOffset = resolved.endOffset;
			}
			// If re-anchoring fails, still add the thread (it becomes orphaned in UI)
		} catch {
			// Vault read failed — still add the thread
		}

		this.threads.push(thread);
		this.anchorIndex.build(this.threads);

		if (this.activeFile) {
			void this.storage.saveImmediate(this.activeFile, this.threads);
		}

		this.onNewThreadCallback?.(thread);
	}

	private handleIncomingMessage(threadId: string, message: ThreadMessage): void {
		const thread = this.threads.find((t) => t.id === threadId);
		if (!thread) return;

		// Check if message ID already exists (skip duplicates)
		if (thread.messages.some((m) => m.id === message.id)) {
			return;
		}

		thread.messages.push(message);
		thread.updatedAt = nowISO();

		if (this.activeFile) {
			void this.storage.saveImmediate(this.activeFile, this.threads);
		}

		this.onNewMessageCallback?.(threadId, message);
	}

	private handleIncomingSuggestion(threadId: string, message: ThreadMessage): void {
		// Suggestions are messages — use the same merge logic
		this.handleIncomingMessage(threadId, message);

		// Also fire suggestion callback
		const thread = this.threads.find((t) => t.id === threadId);
		if (thread) {
			this.onSuggestionCallback?.(threadId, message);
		}
	}

	// --- Outbox ---

	private enqueue(type: string, payload: unknown): void {
		this.outbox.push({
			type,
			payload,
			timestamp: nowISO(),
			retryCount: 0,
		});
	}

	private async drainOutbox(): Promise<void> {
		if (this.draining || this.outbox.length === 0) return;
		this.draining = true;

		const count = this.outbox.length;
		new Notice(`Reconnected — syncing ${count} pending operation${count === 1 ? "" : "s"}`);

		while (this.outbox.length > 0 && this.isConnected()) {
			const entry = this.outbox[0]!;

			try {
				await this.forwardToBackend(entry);
				this.outbox.shift(); // Remove on success
			} catch {
				entry.retryCount++;
				if (entry.retryCount >= MAX_RETRY_COUNT) {
					console.warn(`[agent-comments] Outbox entry '${entry.type}' failed after ${MAX_RETRY_COUNT} retries, discarding. Sidecar data is preserved.`);
					this.outbox.shift(); // Discard after max retries
				} else {
					break; // Stop draining — will retry on next reconnect
				}
			}
		}

		this.draining = false;
	}

	private async forwardToBackend(entry: OutboxEntry): Promise<void> {
		const payload = entry.payload as Record<string, unknown>;

		switch (entry.type) {
			case "createThread":
				await this.wrapped.createThread(
					payload["anchor"] as TextAnchor,
					payload["firstMessage"] as ThreadMessage | undefined,
				);
				break;
			case "addMessage":
				await this.wrapped.addMessage(
					payload["threadId"] as string,
					payload["message"] as ThreadMessage,
				);
				break;
			case "resolveThread":
				await this.wrapped.resolveThread(payload["threadId"] as string);
				break;
			case "reopenThread":
				await this.wrapped.reopenThread(payload["threadId"] as string);
				break;
			case "acceptSuggestion":
				await this.wrapped.acceptSuggestion(
					payload["threadId"] as string,
					payload["messageId"] as string,
				);
				break;
			case "rejectSuggestion":
				await this.wrapped.rejectSuggestion(
					payload["threadId"] as string,
					payload["messageId"] as string,
				);
				break;
			default:
				console.warn(`[agent-comments] Unknown outbox entry type: ${entry.type}`);
		}
	}

	private isConnected(): boolean {
		return this.wrapped.connectionStatus === "connected";
	}

	private ensureActiveFile(): void {
		if (!this.activeFile) {
			throw new Error("No active document. Call setActiveDocument() first.");
		}
	}

	private findThread(threadId: string): CommentThread {
		const thread = this.threads.find((t) => t.id === threadId);
		if (!thread) {
			throw new Error(`Thread '${threadId}' not found`);
		}
		return thread;
	}

	private findMessage(thread: CommentThread, messageId: string): ThreadMessage {
		const message = thread.messages.find((m) => m.id === messageId);
		if (!message) {
			throw new Error(`Message '${messageId}' not found in thread '${thread.id}'`);
		}
		return message;
	}
}
