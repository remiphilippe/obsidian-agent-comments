/**
 * Tests for WebSocket backend client.
 *
 * Uses a mock WebSocket implementation since vitest runs in Node
 * where native WebSocket may not behave like browser WebSocket.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebSocketBackend } from "../../src/backend/websocket";

// --- Mock WebSocket ---

type WSEventHandler = ((event: { data: string }) => void) | (() => void) | null;

// Controls whether new MockWebSocket instances auto-succeed or auto-fail
let mockShouldFail = false;

class MockWebSocket {
	static CONNECTING = 0;
	static OPEN = 1;
	static CLOSING = 2;
	static CLOSED = 3;

	readyState = MockWebSocket.CONNECTING;
	onopen: (() => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	sentMessages: string[] = [];
	url: string;

	constructor(url: string) {
		this.url = url;
		// Capture the fail flag at construction time
		const shouldFail = mockShouldFail;
		// Simulate async connection
		setTimeout(() => {
			if (this.readyState !== MockWebSocket.CONNECTING) return;
			if (shouldFail) {
				this.onerror?.();
				this.readyState = MockWebSocket.CLOSED;
				this.onclose?.();
			} else {
				this.readyState = MockWebSocket.OPEN;
				this.onopen?.();
			}
		}, 0);
	}

	send(data: string): void {
		if (this.readyState !== MockWebSocket.OPEN) {
			throw new Error("WebSocket is not open");
		}
		this.sentMessages.push(data);
	}

	close(): void {
		this.readyState = MockWebSocket.CLOSED;
		this.onclose?.();
	}

	// Test helper: simulate receiving a message
	simulateMessage(data: string): void {
		this.onmessage?.({ data });
	}

	// Test helper: simulate connection failure
	simulateError(): void {
		this.onerror?.();
		this.readyState = MockWebSocket.CLOSED;
		this.onclose?.();
	}
}

// Install mock WebSocket globally
let mockWsInstances: MockWebSocket[] = [];

beforeEach(() => {
	mockWsInstances = [];
	mockShouldFail = false;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(globalThis as any).WebSocket = class extends MockWebSocket {
		constructor(url: string) {
			super(url);
			mockWsInstances.push(this);
		}
	};
	// Add static constants to the global mock
	// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
	(globalThis as any).WebSocket.OPEN = MockWebSocket.OPEN;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
	(globalThis as any).WebSocket.CONNECTING = MockWebSocket.CONNECTING;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
	(globalThis as any).WebSocket.CLOSING = MockWebSocket.CLOSING;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
	(globalThis as any).WebSocket.CLOSED = MockWebSocket.CLOSED;

	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-dynamic-delete
	delete (globalThis as any).WebSocket;
});

function getLatestWs(): MockWebSocket {
	return mockWsInstances[mockWsInstances.length - 1]!;
}

describe("WebSocketBackend", () => {
	describe("construction", () => {
		it("accepts valid ws:// URL", () => {
			expect(() => new WebSocketBackend("ws://localhost:8080")).not.toThrow();
		});

		it("accepts valid wss:// URL", () => {
			expect(() => new WebSocketBackend("wss://example.com/ws")).not.toThrow();
		});

		it("rejects invalid URL", () => {
			expect(() => new WebSocketBackend("not-a-url")).toThrow("Invalid WebSocket URL");
		});

		it("rejects http:// URL", () => {
			expect(() => new WebSocketBackend("http://example.com")).toThrow("Invalid WebSocket URL");
		});

		it("rejects https:// URL", () => {
			expect(() => new WebSocketBackend("https://example.com")).toThrow("Invalid WebSocket URL");
		});
	});

	describe("connection lifecycle", () => {
		it("connects and reports connected status", async () => {
			const backend = new WebSocketBackend("ws://localhost:8080");
			expect(backend.connectionStatus).toBe("disconnected");

			const connectPromise = backend.connect();
			expect(backend.connectionStatus).toBe("connecting");

			await vi.advanceTimersByTimeAsync(0);
			await connectPromise;

			expect(backend.connectionStatus).toBe("connected");
		});

		it("disconnects and reports disconnected status", async () => {
			const backend = new WebSocketBackend("ws://localhost:8080");
			const connectPromise = backend.connect();
			await vi.advanceTimersByTimeAsync(0);
			await connectPromise;

			backend.disconnect();
			expect(backend.connectionStatus).toBe("disconnected");
		});

		it("rejects pending requests on disconnect", async () => {
			const backend = new WebSocketBackend("ws://localhost:8080");
			const connectPromise = backend.connect();
			await vi.advanceTimersByTimeAsync(0);
			await connectPromise;

			// Start a request that won't get a response
			const requestPromise = backend.resolveThread("t1");

			// Disconnect while request is pending
			backend.disconnect();

			await expect(requestPromise).rejects.toThrow("WebSocket disconnected");
		});
	});

	describe("sending messages", () => {
		it("serializes and sends createThread request", async () => {
			const backend = new WebSocketBackend("ws://localhost:8080");
			const connectPromise = backend.connect();
			await vi.advanceTimersByTimeAsync(0);
			await connectPromise;

			const ws = getLatestWs();
			const anchor = {
				anchorText: "test text",
				startOffset: 0,
				endOffset: 9,
			};
			const firstMessage = {
				id: "msg-1",
				author: "human",
				authorType: "human" as const,
				content: "Hello",
				timestamp: "2026-02-27T10:00:00Z",
			};

			// Start request (won't resolve without response)
			const requestPromise = backend.createThread(anchor, firstMessage);

			// Check that message was sent
			expect(ws.sentMessages).toHaveLength(1);
			const sent = JSON.parse(ws.sentMessages[0]!) as { type: string; requestId: string; payload: unknown };
			expect(sent.type).toBe("createThread");
			expect(sent.requestId).toBeTruthy();

			// Simulate server response
			ws.simulateMessage(JSON.stringify({
				type: "threadCreated",
				requestId: sent.requestId,
				payload: {
					thread: { id: "t1", anchor, messages: [firstMessage], status: "open", documentId: "test.md", createdAt: "2026-02-27T10:00:00Z", updatedAt: "2026-02-27T10:00:00Z" },
				},
			}));

			const thread = await requestPromise;
			expect(thread.id).toBe("t1");
		});

		it("rejects request when not connected", async () => {
			const backend = new WebSocketBackend("ws://localhost:8080");
			await expect(backend.resolveThread("t1")).rejects.toThrow("WebSocket is not connected");
		});
	});

	describe("request timeout", () => {
		it("rejects request after 30s timeout", async () => {
			const backend = new WebSocketBackend("ws://localhost:8080");
			const connectPromise = backend.connect();
			await vi.advanceTimersByTimeAsync(0);
			await connectPromise;

			// Capture the rejection before advancing timers
			let timeoutError: Error | null = null;
			const requestPromise = backend.resolveThread("t1").catch((err: Error) => {
				timeoutError = err;
			});

			// Advance past timeout
			await vi.advanceTimersByTimeAsync(30001);
			await requestPromise;

			expect(timeoutError).not.toBeNull();
			expect(timeoutError!.message).toContain("timed out");

			// Clean up
			backend.disconnect();
		});
	});

	describe("push events", () => {
		it("fires onNewThread callback for incoming newThread", async () => {
			const backend = new WebSocketBackend("ws://localhost:8080");
			const connectPromise = backend.connect();
			await vi.advanceTimersByTimeAsync(0);
			await connectPromise;

			const ws = getLatestWs();
			const onNewThread = vi.fn();
			backend.onNewThread(onNewThread);

			const thread = {
				id: "t1",
				documentId: "test.md",
				anchor: { anchorText: "test", startOffset: 0, endOffset: 4 },
				status: "open",
				messages: [],
				createdAt: "2026-02-27T10:00:00Z",
				updatedAt: "2026-02-27T10:00:00Z",
			};

			ws.simulateMessage(JSON.stringify({
				type: "newThread",
				payload: { thread },
			}));

			expect(onNewThread).toHaveBeenCalledOnce();
			expect(onNewThread).toHaveBeenCalledWith(thread);
		});

		it("fires onNewMessage callback for incoming newMessage", async () => {
			const backend = new WebSocketBackend("ws://localhost:8080");
			const connectPromise = backend.connect();
			await vi.advanceTimersByTimeAsync(0);
			await connectPromise;

			const ws = getLatestWs();
			const onNewMessage = vi.fn();
			backend.onNewMessage(onNewMessage);

			const message = {
				id: "msg-1",
				author: "Agent",
				authorType: "agent",
				content: "Response",
				timestamp: "2026-02-27T10:01:00Z",
			};

			ws.simulateMessage(JSON.stringify({
				type: "newMessage",
				payload: { threadId: "t1", message },
			}));

			expect(onNewMessage).toHaveBeenCalledWith("t1", message);
		});

		it("fires onSuggestion callback for incoming suggestion", async () => {
			const backend = new WebSocketBackend("ws://localhost:8080");
			const connectPromise = backend.connect();
			await vi.advanceTimersByTimeAsync(0);
			await connectPromise;

			const ws = getLatestWs();
			const onSuggestion = vi.fn();
			backend.onSuggestion(onSuggestion);

			const message = {
				id: "msg-2",
				author: "WriterAgent",
				authorType: "agent",
				content: "Here is a suggestion",
				timestamp: "2026-02-27T10:02:00Z",
				suggestion: {
					originalText: "old text",
					replacementText: "new text",
					status: "pending",
				},
			};

			ws.simulateMessage(JSON.stringify({
				type: "suggestion",
				payload: { threadId: "t1", message },
			}));

			expect(onSuggestion).toHaveBeenCalledWith("t1", message);
		});

		it("ignores invalid incoming messages without crashing", async () => {
			const backend = new WebSocketBackend("ws://localhost:8080");
			const connectPromise = backend.connect();
			await vi.advanceTimersByTimeAsync(0);
			await connectPromise;

			const ws = getLatestWs();
			const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

			// Send invalid JSON
			ws.simulateMessage("not json at all");
			expect(consoleSpy).toHaveBeenCalled();

			// Send valid JSON with invalid structure
			ws.simulateMessage(JSON.stringify({ type: "unknownType", payload: {} }));

			consoleSpy.mockRestore();
		});
	});

	describe("reconnection", () => {
		it("attempts reconnect on connection loss", async () => {
			const backend = new WebSocketBackend("ws://localhost:8080");
			const connectPromise = backend.connect();
			await vi.advanceTimersByTimeAsync(0);
			await connectPromise;

			expect(backend.connectionStatus).toBe("connected");

			// Simulate connection loss
			const ws = getLatestWs();
			ws.readyState = MockWebSocket.CLOSED;
			ws.onclose?.();

			expect(backend.connectionStatus).toBe("connecting");

			// Advance timer for first reconnect (1s)
			await vi.advanceTimersByTimeAsync(1000);
			// New WebSocket should be created
			expect(mockWsInstances.length).toBeGreaterThan(1);
		});

		it("uses exponential backoff: 1s, 2s, 4s, 8s, max 30s", async () => {
			const backend = new WebSocketBackend("ws://localhost:8080");
			const connectPromise = backend.connect();
			await vi.advanceTimersByTimeAsync(0);
			await connectPromise;

			// Make all future connections fail immediately so backoff isn't reset
			mockShouldFail = true;

			// Initial connection loss
			getLatestWs().simulateError();

			// Each reconnect fires, fails, and schedules the next with doubled delay.
			// Track cumulative time and verify new WS instances at expected intervals.
			const delays = [1000, 2000, 4000, 8000, 16000, 30000, 30000];

			for (const delay of delays) {
				const countBefore = mockWsInstances.length;

				// Advance to just before the reconnect timer
				await vi.advanceTimersByTimeAsync(delay - 1);
				expect(mockWsInstances.length).toBe(countBefore);

				// Advance past — reconnect fires, creates new WS, which auto-fails
				// via setTimeout(0) and schedules next reconnect
				await vi.advanceTimersByTimeAsync(2);
				expect(mockWsInstances.length).toBe(countBefore + 1);
			}
		});

		it("does not reconnect after intentional disconnect", async () => {
			const backend = new WebSocketBackend("ws://localhost:8080");
			const connectPromise = backend.connect();
			await vi.advanceTimersByTimeAsync(0);
			await connectPromise;

			const countBefore = mockWsInstances.length;
			backend.disconnect();

			// Advance time — should not attempt reconnect
			await vi.advanceTimersByTimeAsync(60000);
			expect(mockWsInstances.length).toBe(countBefore);
		});
	});
});
