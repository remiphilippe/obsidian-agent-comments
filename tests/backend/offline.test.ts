/**
 * Tests for the offline-first backend wrapper.
 *
 * Verifies sidecar-first writes, outbox queuing,
 * outbox draining, and duplicate detection.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TFile, Vault } from "obsidian";
import { OfflineAwareBackend } from "../../src/backend/offline";
import { SidecarStorage } from "../../src/storage/sidecar";
import type { AgentCommentsBackend, BackendConnectionStatus } from "../../src/models/backend";
import type { CommentThread, TextAnchor, ThreadMessage } from "../../src/models/thread";
import { createMessage } from "../../src/models/thread";

// --- Mock backend ---

function createMockBackend(status: BackendConnectionStatus = "connected"): AgentCommentsBackend & {
	createThreadCalls: Array<{ anchor: TextAnchor; firstMessage?: ThreadMessage }>;
	addMessageCalls: Array<{ threadId: string; message: ThreadMessage }>;
	resolveThreadCalls: string[];
	setStatus: (s: BackendConnectionStatus) => void;
	failNextCall: boolean;
	alwaysFail: boolean;
	onNewThreadCb: ((thread: CommentThread) => void) | null;
	onNewMessageCb: ((threadId: string, message: ThreadMessage) => void) | null;
	onSuggestionCb: ((threadId: string, message: ThreadMessage) => void) | null;
	connect: () => Promise<void>;
	disconnect: () => void;
} {
	let _status = status;
	const mock = {
		createThreadCalls: [] as Array<{ anchor: TextAnchor; firstMessage?: ThreadMessage }>,
		addMessageCalls: [] as Array<{ threadId: string; message: ThreadMessage }>,
		resolveThreadCalls: [] as string[],
		failNextCall: false,
		alwaysFail: false,
		onNewThreadCb: null as ((thread: CommentThread) => void) | null,
		onNewMessageCb: null as ((threadId: string, message: ThreadMessage) => void) | null,
		onSuggestionCb: null as ((threadId: string, message: ThreadMessage) => void) | null,

		get connectionStatus(): BackendConnectionStatus {
			return _status;
		},

		setStatus(s: BackendConnectionStatus): void {
			_status = s;
		},

		async connect(): Promise<void> {
			// Mock connect — status should already be set by test
		},

		disconnect(): void {
			// Mock disconnect
		},

		async createThread(anchor: TextAnchor, firstMessage?: ThreadMessage): Promise<CommentThread> {
			if (mock.failNextCall || mock.alwaysFail) {
				if (mock.failNextCall) mock.failNextCall = false;
				throw new Error("Backend failure");
			}
			mock.createThreadCalls.push({ anchor, firstMessage });
			const now = new Date().toISOString();
			return {
				id: "backend-t1",
				documentId: "test.md",
				anchor,
				status: "open",
				messages: firstMessage ? [firstMessage] : [],
				createdAt: firstMessage?.timestamp ?? now,
				updatedAt: firstMessage?.timestamp ?? now,
			};
		},

		async addMessage(threadId: string, message: ThreadMessage): Promise<ThreadMessage> {
			if (mock.failNextCall || mock.alwaysFail) {
				if (mock.failNextCall) mock.failNextCall = false;
				throw new Error("Backend failure");
			}
			mock.addMessageCalls.push({ threadId, message });
			return message;
		},

		async resolveThread(threadId: string): Promise<void> {
			if (mock.failNextCall || mock.alwaysFail) {
				if (mock.failNextCall) mock.failNextCall = false;
				throw new Error("Backend failure");
			}
			mock.resolveThreadCalls.push(threadId);
		},

		async reopenThread(_threadId: string): Promise<void> {
			// Stub
		},

		async acceptSuggestion(_threadId: string, _messageId: string): Promise<void> {
			// Stub
		},

		async rejectSuggestion(_threadId: string, _messageId: string): Promise<void> {
			// Stub
		},

		onNewThread(callback: (thread: CommentThread) => void): void {
			mock.onNewThreadCb = callback;
		},

		onNewMessage(callback: (threadId: string, message: ThreadMessage) => void): void {
			mock.onNewMessageCb = callback;
		},

		onSuggestion(callback: (threadId: string, message: ThreadMessage) => void): void {
			mock.onSuggestionCb = callback;
		},
	};
	return mock;
}

// --- Helpers ---

function makeAnchor(): TextAnchor {
	return {
		anchorText: "test text",
		startOffset: 0,
		endOffset: 9,
	};
}

function makeMessage(content = "Hello"): ThreadMessage {
	return createMessage({
		author: "human",
		authorType: "human",
		content,
	});
}

const testFile = new TFile("test.md", "test", "md");

describe("OfflineAwareBackend", () => {
	let vault: Vault;
	let storage: SidecarStorage;

	beforeEach(() => {
		vault = new Vault();
		storage = new SidecarStorage(vault);
	});

	describe("connected operations", () => {
		it("writes to sidecar AND forwards to backend when connected", async () => {
			const mockBackend = createMockBackend("connected");
			const offline = new OfflineAwareBackend(mockBackend, storage, vault);
			await offline.setActiveDocument(testFile);

			const anchor = makeAnchor();
			const msg = makeMessage();
			await offline.createThread(anchor, msg);

			// Verify sidecar was written
			const threads = offline.getThreads();
			expect(threads).toHaveLength(1);
			expect(threads[0]!.anchor.anchorText).toBe("test text");

			// Verify backend was forwarded
			expect(mockBackend.createThreadCalls).toHaveLength(1);

			// Verify outbox is empty (operation succeeded)
			expect(offline.getOutbox()).toHaveLength(0);
		});

		it("addMessage writes to sidecar AND forwards when connected", async () => {
			const mockBackend = createMockBackend("connected");
			const offline = new OfflineAwareBackend(mockBackend, storage, vault);
			await offline.setActiveDocument(testFile);

			const anchor = makeAnchor();
			const firstMsg = makeMessage("First");
			const thread = await offline.createThread(anchor, firstMsg);

			const secondMsg = makeMessage("Second");
			await offline.addMessage(thread.id, secondMsg);

			expect(offline.getThreads()[0]!.messages).toHaveLength(2);
			expect(mockBackend.addMessageCalls).toHaveLength(1);
		});
	});

	describe("disconnected operations", () => {
		it("writes to sidecar and queues in outbox when disconnected", async () => {
			const mockBackend = createMockBackend("disconnected");
			const offline = new OfflineAwareBackend(mockBackend, storage, vault);
			await offline.setActiveDocument(testFile);

			const anchor = makeAnchor();
			const msg = makeMessage();
			await offline.createThread(anchor, msg);

			// Sidecar written
			const threads = offline.getThreads();
			expect(threads).toHaveLength(1);

			// Backend NOT forwarded
			expect(mockBackend.createThreadCalls).toHaveLength(0);

			// Outbox has the entry
			expect(offline.getOutbox()).toHaveLength(1);
			expect(offline.getOutbox()[0]!.type).toBe("createThread");
		});

		it("resolveThread writes to sidecar and queues when disconnected", async () => {
			const mockBackend = createMockBackend("connected");
			const offline = new OfflineAwareBackend(mockBackend, storage, vault);
			await offline.setActiveDocument(testFile);

			const thread = await offline.createThread(makeAnchor(), makeMessage());

			// Go offline
			mockBackend.setStatus("disconnected");

			await offline.resolveThread(thread.id);

			expect(offline.getThreads()[0]!.status).toBe("resolved");
			expect(mockBackend.resolveThreadCalls).toHaveLength(0);
			expect(offline.getOutbox()).toHaveLength(1);
		});
	});

	describe("outbox draining", () => {
		it("drains outbox in FIFO order on reconnect", async () => {
			const mockBackend = createMockBackend("disconnected");
			const offline = new OfflineAwareBackend(mockBackend, storage, vault);
			await offline.setActiveDocument(testFile);

			// Queue two operations while offline
			const thread = await offline.createThread(makeAnchor(), makeMessage("First"));
			await offline.addMessage(thread.id, makeMessage("Second"));

			expect(offline.getOutbox()).toHaveLength(2);

			// Reconnect triggers drain
			mockBackend.setStatus("connected");
			await offline.connect();

			// Drain is async — give it a tick to complete
			await new Promise<void>((resolve) => setTimeout(resolve, 0));

			expect(offline.getOutbox()).toHaveLength(0);
			expect(mockBackend.createThreadCalls).toHaveLength(1);
			expect(mockBackend.addMessageCalls).toHaveLength(1);
		});

		it("discards entry after max retries (3)", async () => {
			const mockBackend = createMockBackend("connected");
			const offline = new OfflineAwareBackend(mockBackend, storage, vault);
			await offline.setActiveDocument(testFile);

			// Queue an operation while disconnected
			mockBackend.setStatus("disconnected");
			await offline.createThread(makeAnchor(), makeMessage());
			expect(offline.getOutbox()).toHaveLength(1);

			const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

			// Reconnect but make backend always fail
			mockBackend.setStatus("connected");
			mockBackend.alwaysFail = true;
			await offline.connect();
			await new Promise<void>((resolve) => setTimeout(resolve, 0));

			// After drain attempt (alwaysFail = true, first failure breaks loop at retryCount=1)
			// Retry 2 more times
			await offline.connect();
			await new Promise<void>((resolve) => setTimeout(resolve, 0));
			await offline.connect();
			await new Promise<void>((resolve) => setTimeout(resolve, 0));

			// After 3 failures, entry should be discarded
			expect(offline.getOutbox()).toHaveLength(0);

			// Sidecar data still preserved
			expect(offline.getThreads()).toHaveLength(1);

			consoleSpy.mockRestore();
		});
	});

	describe("plugin unload", () => {
		it("clearOutbox removes all pending operations", async () => {
			const mockBackend = createMockBackend("disconnected");
			const offline = new OfflineAwareBackend(mockBackend, storage, vault);
			await offline.setActiveDocument(testFile);

			await offline.createThread(makeAnchor(), makeMessage());
			expect(offline.getOutbox()).toHaveLength(1);

			offline.clearOutbox();
			expect(offline.getOutbox()).toHaveLength(0);
		});
	});

	describe("incoming message deduplication", () => {
		it("does not add duplicate incoming thread", async () => {
			const mockBackend = createMockBackend("connected");
			const offline = new OfflineAwareBackend(mockBackend, storage, vault);
			await offline.setActiveDocument(testFile);

			const thread = await offline.createThread(makeAnchor(), makeMessage());

			// Simulate backend pushing the same thread back
			const onNewThread = vi.fn();
			offline.onNewThread(onNewThread);

			// Trigger the incoming thread handler via mock backend callback
			mockBackend.onNewThreadCb?.({
				...thread,
			});

			// Thread should not be duplicated
			expect(offline.getThreads()).toHaveLength(1);
			// Callback should NOT fire for duplicate
			expect(onNewThread).not.toHaveBeenCalled();
		});

		it("adds new incoming thread from agent", async () => {
			const mockBackend = createMockBackend("connected");
			const offline = new OfflineAwareBackend(mockBackend, storage, vault);
			await offline.setActiveDocument(testFile);

			const onNewThread = vi.fn();
			offline.onNewThread(onNewThread);

			const agentThread: CommentThread = {
				id: "agent-thread-1",
				documentId: "test.md",
				anchor: { anchorText: "some text", startOffset: 10, endOffset: 19 },
				status: "open",
				messages: [
					{
						id: "agent-msg-1",
						author: "ResearchAgent",
						authorType: "agent",
						content: "Found an issue here",
						timestamp: "2026-02-27T10:00:00Z",
					},
				],
				createdAt: "2026-02-27T10:00:00Z",
				updatedAt: "2026-02-27T10:00:00Z",
			};

			mockBackend.onNewThreadCb?.(agentThread);

			// Wait for async re-anchoring
			await new Promise<void>((resolve) => setTimeout(resolve, 10));

			expect(offline.getThreads()).toHaveLength(1);
			expect(offline.getThreads()[0]!.id).toBe("agent-thread-1");
			expect(onNewThread).toHaveBeenCalledOnce();
		});

		it("does not add duplicate incoming message", async () => {
			const mockBackend = createMockBackend("connected");
			const offline = new OfflineAwareBackend(mockBackend, storage, vault);
			await offline.setActiveDocument(testFile);

			const msg = makeMessage();
			const thread = await offline.createThread(makeAnchor(), msg);

			const onNewMessage = vi.fn();
			offline.onNewMessage(onNewMessage);

			// Push the same message back
			mockBackend.onNewMessageCb?.(thread.id, msg);

			// Should still have only 1 message
			expect(offline.getThreads()[0]!.messages).toHaveLength(1);
			expect(onNewMessage).not.toHaveBeenCalled();
		});

		it("adds new incoming message from agent", async () => {
			const mockBackend = createMockBackend("connected");
			const offline = new OfflineAwareBackend(mockBackend, storage, vault);
			await offline.setActiveDocument(testFile);

			const thread = await offline.createThread(makeAnchor(), makeMessage());

			const onNewMessage = vi.fn();
			offline.onNewMessage(onNewMessage);

			const agentMsg: ThreadMessage = {
				id: "agent-response-1",
				author: "ResearchAgent",
				authorType: "agent",
				content: "Agent response",
				timestamp: "2026-02-27T10:01:00Z",
			};

			mockBackend.onNewMessageCb?.(thread.id, agentMsg);

			expect(offline.getThreads()[0]!.messages).toHaveLength(2);
			expect(onNewMessage).toHaveBeenCalledWith(thread.id, agentMsg);
		});
	});

	describe("incoming thread re-anchoring", () => {
		it("re-anchors incoming thread against current document", async () => {
			const mockBackend = createMockBackend("connected");
			const offline = new OfflineAwareBackend(mockBackend, storage, vault);

			// Create a document with known content
			await vault.create("test.md", "Hello world, some test text here.");
			await offline.setActiveDocument(testFile);

			const onNewThread = vi.fn();
			offline.onNewThread(onNewThread);

			// Incoming thread with stale offsets — anchorText is "test text" but offsets are wrong
			const agentThread: CommentThread = {
				id: "re-anchor-1",
				documentId: "test.md",
				anchor: {
					anchorText: "test text",
					startOffset: 999, // stale offset
					endOffset: 1008,  // stale offset
				},
				status: "open",
				messages: [{
					id: "msg-1",
					author: "Agent",
					authorType: "agent",
					content: "Found something",
					timestamp: "2026-02-27T12:00:00Z",
				}],
				createdAt: "2026-02-27T12:00:00Z",
				updatedAt: "2026-02-27T12:00:00Z",
			};

			mockBackend.onNewThreadCb?.(agentThread);

			// Wait for async re-anchoring
			await new Promise<void>((resolve) => setTimeout(resolve, 10));

			const threads = offline.getThreads();
			expect(threads).toHaveLength(1);
			// Anchor should have been re-resolved to the correct position
			expect(threads[0]!.anchor.startOffset).toBe(18); // "test text" starts at index 18
			expect(threads[0]!.anchor.endOffset).toBe(27);
			expect(onNewThread).toHaveBeenCalledOnce();
		});

		it("adds incoming thread even when re-anchor fails", async () => {
			const mockBackend = createMockBackend("connected");
			const offline = new OfflineAwareBackend(mockBackend, storage, vault);

			// Create a document without the anchor text
			await vault.create("test.md", "Completely different content");
			await offline.setActiveDocument(testFile);

			const onNewThread = vi.fn();
			offline.onNewThread(onNewThread);

			const agentThread: CommentThread = {
				id: "orphan-1",
				documentId: "test.md",
				anchor: {
					anchorText: "nonexistent text",
					startOffset: 0,
					endOffset: 16,
				},
				status: "open",
				messages: [{
					id: "msg-1",
					author: "Agent",
					authorType: "agent",
					content: "Thread that will become orphaned",
					timestamp: "2026-02-27T12:00:00Z",
				}],
				createdAt: "2026-02-27T12:00:00Z",
				updatedAt: "2026-02-27T12:00:00Z",
			};

			mockBackend.onNewThreadCb?.(agentThread);

			// Wait for async re-anchoring
			await new Promise<void>((resolve) => setTimeout(resolve, 10));

			// Thread should still be added (with original stale offsets)
			const threads = offline.getThreads();
			expect(threads).toHaveLength(1);
			expect(threads[0]!.id).toBe("orphan-1");
			expect(onNewThread).toHaveBeenCalledOnce();
		});
	});

	describe("backend failure handling", () => {
		it("queues in outbox when backend call fails while connected", async () => {
			const mockBackend = createMockBackend("connected");
			const offline = new OfflineAwareBackend(mockBackend, storage, vault);
			await offline.setActiveDocument(testFile);

			// Make the backend fail
			mockBackend.failNextCall = true;

			const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

			const anchor = makeAnchor();
			const msg = makeMessage();
			await offline.createThread(anchor, msg);

			// Sidecar still written
			expect(offline.getThreads()).toHaveLength(1);

			// Backend call failed — queued in outbox
			expect(offline.getOutbox()).toHaveLength(1);

			consoleSpy.mockRestore();
		});
	});

	describe("connection status", () => {
		it("reports 'offline' when inner backend is disconnected", () => {
			const mockBackend = createMockBackend("disconnected");
			const offline = new OfflineAwareBackend(mockBackend, storage, vault);
			expect(offline.connectionStatus).toBe("offline");
		});

		it("reports 'offline' when inner backend is connecting", () => {
			const mockBackend = createMockBackend("connecting");
			const offline = new OfflineAwareBackend(mockBackend, storage, vault);
			expect(offline.connectionStatus).toBe("offline");
		});

		it("reports 'connected' when inner backend is connected", () => {
			const mockBackend = createMockBackend("connected");
			const offline = new OfflineAwareBackend(mockBackend, storage, vault);
			expect(offline.connectionStatus).toBe("connected");
		});

		it("reports 'error' when inner backend is in error", () => {
			const mockBackend = createMockBackend("error");
			const offline = new OfflineAwareBackend(mockBackend, storage, vault);
			expect(offline.connectionStatus).toBe("error");
		});
	});
});
