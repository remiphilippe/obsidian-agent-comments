/**
 * WebSocket wire format and message validation.
 *
 * Defines the JSON protocol for communication between
 * the plugin (client) and any backend (server).
 */

import type { CommentThread, TextAnchor, ThreadMessage } from "../models/thread";

// --- Client → Server messages ---

export type ClientMessageType =
	| "createThread"
	| "addMessage"
	| "resolveThread"
	| "reopenThread"
	| "acceptSuggestion"
	| "rejectSuggestion";

export interface ClientMessage {
	type: ClientMessageType;
	requestId: string;
	payload: unknown;
}

export interface CreateThreadPayload {
	anchor: TextAnchor;
	firstMessage: ThreadMessage;
}

export interface AddMessagePayload {
	threadId: string;
	message: ThreadMessage;
}

export interface ThreadIdPayload {
	threadId: string;
}

export interface SuggestionPayload {
	threadId: string;
	messageId: string;
}

// --- Server → Client messages ---

export type ServerMessageType =
	| "threadCreated"
	| "messageAdded"
	| "threadResolved"
	| "threadReopened"
	| "suggestionAccepted"
	| "suggestionRejected"
	| "newThread"
	| "newMessage"
	| "suggestion"
	| "error";

export interface ServerMessage {
	type: ServerMessageType;
	requestId?: string;  // present for responses to client requests
	payload: unknown;
}

export interface ErrorPayload {
	message: string;
	code?: string;
}

export interface NewThreadPayload {
	thread: CommentThread;
}

export interface NewMessagePayload {
	threadId: string;
	message: ThreadMessage;
}

// --- Serialization ---

export function serializeClientMessage(msg: ClientMessage): string {
	return JSON.stringify(msg);
}

export function deserializeServerMessage(raw: string): ServerMessage | null {
	try {
		const data: unknown = JSON.parse(raw);
		if (validateServerMessage(data)) {
			return data;
		}
		return null;
	} catch {
		return null;
	}
}

// --- Validation ---

const VALID_SERVER_TYPES: ReadonlySet<string> = new Set([
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
]);

/**
 * Type guard that validates incoming server messages.
 * Accepts messages with extra fields (forward compatibility).
 */
export function validateServerMessage(data: unknown): data is ServerMessage {
	if (typeof data !== "object" || data === null) {
		return false;
	}

	const obj = data as Record<string, unknown>;

	if (typeof obj["type"] !== "string") {
		return false;
	}

	if (!VALID_SERVER_TYPES.has(obj["type"])) {
		return false;
	}

	// requestId is optional but must be string if present
	if ("requestId" in obj && obj["requestId"] !== undefined && typeof obj["requestId"] !== "string") {
		return false;
	}

	// payload must exist
	if (!("payload" in obj)) {
		return false;
	}

	return true;
}

/**
 * Validates the payload structure of specific server message types.
 * Returns true if the payload matches the expected shape for the type.
 */
export function validateServerPayload(msg: ServerMessage): boolean {
	const payload = msg.payload as Record<string, unknown> | null;

	switch (msg.type) {
		case "newThread":
		case "threadCreated":
			return payload !== null && typeof payload === "object" && "thread" in payload;

		case "newMessage":
		case "messageAdded":
		case "suggestion":
			if (payload === null || typeof payload !== "object") return false;
			return typeof payload["threadId"] === "string" && "message" in payload;

		case "error":
			if (payload === null || typeof payload !== "object") return false;
			return typeof payload["message"] === "string";

		case "threadResolved":
		case "threadReopened":
		case "suggestionAccepted":
		case "suggestionRejected":
			// These are acknowledgments — payload may be minimal
			return payload !== null && typeof payload === "object";

		default:
			return true;
	}
}
