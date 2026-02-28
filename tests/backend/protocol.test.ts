/**
 * Tests for WebSocket protocol message validation and serialization.
 */

import { describe, it, expect } from "vitest";
import {
	validateServerMessage,
	validateServerPayload,
	serializeClientMessage,
	deserializeServerMessage,
	type ClientMessage,
	type ServerMessage,
} from "../../src/backend/protocol";

describe("validateServerMessage", () => {
	it("accepts valid server message with all fields", () => {
		const msg = {
			type: "newThread",
			requestId: "req-123",
			payload: { thread: {} },
		};
		expect(validateServerMessage(msg)).toBe(true);
	});

	it("accepts valid message without requestId", () => {
		const msg = {
			type: "newMessage",
			payload: { threadId: "t1", message: {} },
		};
		expect(validateServerMessage(msg)).toBe(true);
	});

	it("rejects null", () => {
		expect(validateServerMessage(null)).toBe(false);
	});

	it("rejects non-object", () => {
		expect(validateServerMessage("not an object")).toBe(false);
	});

	it("rejects missing type", () => {
		expect(validateServerMessage({ payload: {} })).toBe(false);
	});

	it("rejects non-string type", () => {
		expect(validateServerMessage({ type: 123, payload: {} })).toBe(false);
	});

	it("rejects unknown type", () => {
		expect(validateServerMessage({ type: "unknownType", payload: {} })).toBe(false);
	});

	it("rejects non-string requestId", () => {
		const msg = { type: "newThread", requestId: 123, payload: {} };
		expect(validateServerMessage(msg)).toBe(false);
	});

	it("rejects missing payload", () => {
		expect(validateServerMessage({ type: "newThread" })).toBe(false);
	});

	it("accepts messages with extra fields (forward compat)", () => {
		const msg = {
			type: "newThread",
			payload: { thread: {} },
			extraField: "ignored",
			anotherExtra: 42,
		};
		expect(validateServerMessage(msg)).toBe(true);
	});

	it("accepts all valid server message types", () => {
		const types = [
			"threadCreated",
			"messageAdded",
			"threadResolved",
			"threadReopened",
			"suggestionAccepted",
			"suggestionRejected",
			"newThread",
			"newMessage",
			"suggestion",
			"error",
		];
		for (const type of types) {
			expect(validateServerMessage({ type, payload: {} })).toBe(true);
		}
	});
});

describe("validateServerPayload", () => {
	it("validates newThread payload with thread", () => {
		const msg: ServerMessage = {
			type: "newThread",
			payload: { thread: { id: "t1" } },
		};
		expect(validateServerPayload(msg)).toBe(true);
	});

	it("rejects newThread payload without thread", () => {
		const msg: ServerMessage = {
			type: "newThread",
			payload: { notThread: true },
		};
		expect(validateServerPayload(msg)).toBe(false);
	});

	it("validates newMessage payload with threadId and message", () => {
		const msg: ServerMessage = {
			type: "newMessage",
			payload: { threadId: "t1", message: {} },
		};
		expect(validateServerPayload(msg)).toBe(true);
	});

	it("rejects newMessage payload without threadId", () => {
		const msg: ServerMessage = {
			type: "newMessage",
			payload: { message: {} },
		};
		expect(validateServerPayload(msg)).toBe(false);
	});

	it("validates error payload with message string", () => {
		const msg: ServerMessage = {
			type: "error",
			payload: { message: "something went wrong" },
		};
		expect(validateServerPayload(msg)).toBe(true);
	});

	it("rejects error payload without message", () => {
		const msg: ServerMessage = {
			type: "error",
			payload: { code: "ERR" },
		};
		expect(validateServerPayload(msg)).toBe(false);
	});

	it("validates suggestion payload like newMessage", () => {
		const msg: ServerMessage = {
			type: "suggestion",
			payload: { threadId: "t1", message: { suggestion: {} } },
		};
		expect(validateServerPayload(msg)).toBe(true);
	});

	it("validates acknowledgment types with minimal payload", () => {
		for (const type of ["threadResolved", "threadReopened", "suggestionAccepted", "suggestionRejected"] as const) {
			const msg: ServerMessage = { type, payload: {} };
			expect(validateServerPayload(msg)).toBe(true);
		}
	});
});

describe("serializeClientMessage", () => {
	it("serializes client message to JSON", () => {
		const msg: ClientMessage = {
			type: "createThread",
			requestId: "req-1",
			payload: { anchor: { anchorText: "test" } },
		};
		const json = serializeClientMessage(msg);
		const parsed = JSON.parse(json) as ClientMessage;
		expect(parsed.type).toBe("createThread");
		expect(parsed.requestId).toBe("req-1");
	});
});

describe("deserializeServerMessage", () => {
	it("deserializes valid JSON server message", () => {
		const raw = JSON.stringify({
			type: "newThread",
			payload: { thread: { id: "t1" } },
		});
		const msg = deserializeServerMessage(raw);
		expect(msg).not.toBeNull();
		expect(msg!.type).toBe("newThread");
	});

	it("returns null for invalid JSON", () => {
		expect(deserializeServerMessage("not json")).toBeNull();
	});

	it("returns null for valid JSON that fails validation", () => {
		expect(deserializeServerMessage(JSON.stringify({ no: "type" }))).toBeNull();
	});

	it("returns null for JSON with unknown type", () => {
		expect(deserializeServerMessage(JSON.stringify({ type: "bogus", payload: {} }))).toBeNull();
	});
});
