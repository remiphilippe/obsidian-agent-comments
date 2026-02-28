/**
 * Core data model for comment threads.
 * Matches IMPLEMENTATION.md section 2 exactly.
 */

import { generateId, nowISO } from "../utils/ids";

// --- Type aliases ---

export type ThreadStatus = "open" | "resolved";
export type SuggestionStatus = "pending" | "accepted" | "rejected";
export type AuthorType = "human" | "agent";

// --- Interfaces ---

export interface TextAnchor {
	anchorText: string;
	startOffset: number;
	endOffset: number;
	sectionHeading?: string;
}

export interface Suggestion {
	originalText: string;
	replacementText: string;
	status: SuggestionStatus;
}

export interface ThreadMessage {
	id: string;
	author: string;
	authorType: AuthorType;
	content: string;
	timestamp: string; // ISO 8601
	suggestion?: Suggestion;
	knowledgeRefs?: string[];
}

export interface CommentThread {
	id: string;
	documentId: string;
	anchor: TextAnchor;
	status: ThreadStatus;
	messages: ThreadMessage[];
	createdAt: string; // ISO 8601
	updatedAt: string; // ISO 8601
}

export interface SidecarFile {
	version: number;
	documentId: string;
	threads: CommentThread[];
}

// --- Factory functions ---

export function createThread(params: {
	documentId: string;
	anchor: TextAnchor;
	firstMessage?: ThreadMessage;
}): CommentThread {
	const now = nowISO();
	const thread: CommentThread = {
		id: generateId(),
		documentId: params.documentId,
		anchor: params.anchor,
		status: "open",
		messages: params.firstMessage ? [params.firstMessage] : [],
		createdAt: now,
		updatedAt: now,
	};
	return thread;
}

export function createMessage(params: {
	author: string;
	authorType: AuthorType;
	content: string;
	suggestion?: Suggestion;
	knowledgeRefs?: string[];
}): ThreadMessage {
	const message: ThreadMessage = {
		id: generateId(),
		author: params.author,
		authorType: params.authorType,
		content: params.content,
		timestamp: nowISO(),
	};
	if (params.suggestion) {
		message.suggestion = params.suggestion;
	}
	if (params.knowledgeRefs && params.knowledgeRefs.length > 0) {
		message.knowledgeRefs = params.knowledgeRefs;
	}
	return message;
}

export function createSuggestion(params: {
	originalText: string;
	replacementText: string;
}): Suggestion {
	return {
		originalText: params.originalText,
		replacementText: params.replacementText,
		status: "pending",
	};
}

// --- Validation ---

const VALID_THREAD_STATUSES: ReadonlySet<string> = new Set(["open", "resolved"]);
const VALID_SUGGESTION_STATUSES: ReadonlySet<string> = new Set(["pending", "accepted", "rejected"]);
const VALID_AUTHOR_TYPES: ReadonlySet<string> = new Set(["human", "agent"]);
const CURRENT_SCHEMA_VERSION = 1;

export interface ValidationResult {
	valid: boolean;
	error?: string;
}

export function validateSidecarFile(data: unknown): ValidationResult {
	if (typeof data !== "object" || data === null) {
		return { valid: false, error: "Sidecar data must be an object" };
	}

	const obj = data as Record<string, unknown>;

	// Version check
	if (!("version" in obj) || typeof obj["version"] !== "number") {
		return { valid: false, error: "Missing or invalid 'version' field" };
	}
	if (obj["version"] !== CURRENT_SCHEMA_VERSION) {
		return { valid: false, error: `Unsupported schema version: ${obj["version"]} (expected ${CURRENT_SCHEMA_VERSION})` };
	}

	// Threads array
	if (!("threads" in obj) || !Array.isArray(obj["threads"])) {
		return { valid: false, error: "Missing or invalid 'threads' array" };
	}

	const threads = obj["threads"] as unknown[];
	for (let i = 0; i < threads.length; i++) {
		const result = validateThread(threads[i], i);
		if (!result.valid) {
			return result;
		}
	}

	return { valid: true };
}

function validateThread(data: unknown, index: number): ValidationResult {
	if (typeof data !== "object" || data === null) {
		return { valid: false, error: `Thread at index ${index} must be an object` };
	}

	const thread = data as Record<string, unknown>;

	if (!thread["id"] || typeof thread["id"] !== "string") {
		return { valid: false, error: `Thread at index ${index} missing 'id'` };
	}

	if (!thread["anchor"] || typeof thread["anchor"] !== "object") {
		return { valid: false, error: `Thread '${thread["id"]}' missing 'anchor'` };
	}

	const threadStatus = thread["status"];
	if (typeof threadStatus === "string" && !VALID_THREAD_STATUSES.has(threadStatus)) {
		return { valid: false, error: `Thread '${thread["id"]}' has invalid status: '${threadStatus}'` };
	}

	if (!Array.isArray(thread["messages"])) {
		return { valid: false, error: `Thread '${String(thread["id"])}' missing 'messages' array` };
	}

	const threadId = String(thread["id"]);
	const messages = thread["messages"] as unknown[];
	for (let j = 0; j < messages.length; j++) {
		const result = validateMessage(messages[j], threadId, j);
		if (!result.valid) {
			return result;
		}
	}

	return { valid: true };
}

function validateMessage(data: unknown, threadId: string, index: number): ValidationResult {
	if (typeof data !== "object" || data === null) {
		return { valid: false, error: `Message at index ${index} in thread '${threadId}' must be an object` };
	}

	const msg = data as Record<string, unknown>;

	if (!msg["id"] || typeof msg["id"] !== "string") {
		return { valid: false, error: `Message at index ${index} in thread '${threadId}' missing 'id'` };
	}

	const authorType = msg["authorType"];
	if (typeof authorType === "string" && !VALID_AUTHOR_TYPES.has(authorType)) {
		return { valid: false, error: `Message '${msg["id"]}' in thread '${threadId}' has invalid authorType: '${authorType}'` };
	}

	if (msg["suggestion"]) {
		const suggestion = msg["suggestion"] as Record<string, unknown>;
		const suggestionStatus = suggestion["status"];
		if (typeof suggestionStatus === "string" && !VALID_SUGGESTION_STATUSES.has(suggestionStatus)) {
			return { valid: false, error: `Suggestion in message '${msg["id"]}' has invalid status: '${suggestionStatus}'` };
		}
	}

	return { valid: true };
}
