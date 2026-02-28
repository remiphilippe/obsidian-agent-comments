/**
 * Local backend — thread lifecycle with sidecar-only storage.
 * No network. All operations write directly to sidecar files.
 */

import { TFile, Vault } from "obsidian";
import type {
	AgentCommentsBackend,
	BackendConnectionStatus,
} from "../models/backend";
import type {
	CommentThread,
	TextAnchor,
	ThreadMessage,
} from "../models/thread";
import { createThread } from "../models/thread";
import { SidecarStorage } from "../storage/sidecar";
import { AnchorIndex } from "../storage/anchor";
import { nowISO } from "../utils/ids";

export class LocalBackend implements AgentCommentsBackend {
	private storage: SidecarStorage;
	private vault: Vault;
	private activeFile: TFile | null = null;
	private threads: CommentThread[] = [];
	private anchorIndex = new AnchorIndex();

	// Callbacks
	private onNewThreadCallback: ((thread: CommentThread) => void) | null = null;
	private onNewMessageCallback: ((threadId: string, message: ThreadMessage) => void) | null = null;
	private onSuggestionCallback: ((threadId: string, message: ThreadMessage) => void) | null = null;

	readonly connectionStatus: BackendConnectionStatus = "offline";

	constructor(storage: SidecarStorage, vault: Vault) {
		this.storage = storage;
		this.vault = vault;
	}

	/**
	 * Sets the active document and loads its threads.
	 */
	async setActiveDocument(file: TFile): Promise<void> {
		this.activeFile = file;
		this.threads = await this.storage.load(file);
		this.anchorIndex.build(this.threads);
	}

	/**
	 * Returns the current threads for the active document.
	 */
	getThreads(): CommentThread[] {
		return this.threads;
	}

	async createThread(anchor: TextAnchor, firstMessage?: ThreadMessage): Promise<CommentThread> {
		this.ensureActiveFile();

		const thread = createThread({
			documentId: this.activeFile!.path,
			anchor,
			firstMessage,
		});

		this.threads.push(thread);
		this.anchorIndex.build(this.threads);
		await this.storage.saveImmediate(this.activeFile!, this.threads);

		this.onNewThreadCallback?.(thread);
		return thread;
	}

	async addMessage(threadId: string, message: ThreadMessage): Promise<ThreadMessage> {
		this.ensureActiveFile();

		const thread = this.findThread(threadId);
		thread.messages.push(message);
		thread.updatedAt = nowISO();

		await this.storage.saveImmediate(this.activeFile!, this.threads);

		this.onNewMessageCallback?.(threadId, message);
		return message;
	}

	async resolveThread(threadId: string): Promise<void> {
		this.ensureActiveFile();

		const thread = this.findThread(threadId);
		thread.status = "resolved";
		thread.updatedAt = nowISO();

		await this.storage.saveImmediate(this.activeFile!, this.threads);
	}

	async reopenThread(threadId: string): Promise<void> {
		this.ensureActiveFile();

		const thread = this.findThread(threadId);
		thread.status = "open";
		thread.updatedAt = nowISO();

		await this.storage.saveImmediate(this.activeFile!, this.threads);
	}

	/**
	 * Accepts a suggestion — critical path with safety checks.
	 *
	 * 1. Read current document content
	 * 2. Validate originalText matches at anchor position
	 * 3. Apply replacement atomically via vault.modify()
	 * 4. Re-anchor all other threads (offsets shifted)
	 * 5. Set suggestion status 'accepted'
	 * 6. Save sidecar
	 */
	async acceptSuggestion(threadId: string, messageId: string): Promise<void> {
		this.ensureActiveFile();

		const thread = this.findThread(threadId);
		const message = this.findMessage(thread, messageId);

		if (!message.suggestion) {
			throw new Error(`Message '${messageId}' has no suggestion`);
		}

		if (message.suggestion.status !== "pending") {
			throw new Error(
				`Suggestion in message '${messageId}' is already '${message.suggestion.status}'`,
			);
		}

		// Step 1: Read current document content
		const content = await this.vault.read(this.activeFile!);

		// Step 2: Validate originalText matches at anchor position
		const { startOffset, endOffset } = thread.anchor;
		const currentText = content.slice(startOffset, endOffset);

		// Validate originalText exists within the anchor range
		const { originalText, replacementText } = message.suggestion;

		if (!currentText.includes(originalText)) {
			throw new Error(
				`Original text not found at anchor position. The document may have changed since the suggestion was made.`,
			);
		}

		const localIdx = currentText.indexOf(originalText);
		const replaceStart = startOffset + localIdx;
		const replaceEnd = replaceStart + originalText.length;

		// Step 3: Apply replacement atomically
		const newContent =
			content.slice(0, replaceStart) +
			replacementText +
			content.slice(replaceEnd);

		await this.vault.modify(this.activeFile!, newContent);

		// Step 4: Re-anchor all other threads
		const delta = replacementText.length - originalText.length;
		if (delta !== 0) {
			this.anchorIndex.applyOffsetShift(replaceStart, replaceEnd, replacementText.length);
		}

		// Step 5: Set suggestion status
		message.suggestion.status = "accepted";
		thread.updatedAt = nowISO();

		// Step 6: Save sidecar
		await this.storage.saveImmediate(this.activeFile!, this.threads);
	}

	async rejectSuggestion(threadId: string, messageId: string): Promise<void> {
		this.ensureActiveFile();

		const thread = this.findThread(threadId);
		const message = this.findMessage(thread, messageId);

		if (!message.suggestion) {
			throw new Error(`Message '${messageId}' has no suggestion`);
		}

		if (message.suggestion.status !== "pending") {
			throw new Error(
				`Suggestion in message '${messageId}' is already '${message.suggestion.status}'`,
			);
		}

		message.suggestion.status = "rejected";
		thread.updatedAt = nowISO();

		await this.storage.saveImmediate(this.activeFile!, this.threads);
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
