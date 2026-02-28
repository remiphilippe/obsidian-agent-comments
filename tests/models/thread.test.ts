import { describe, it, expect } from "vitest";
import {
	createThread,
	createMessage,
	createSuggestion,
	validateSidecarFile,
	type CommentThread,
	type SidecarFile,
	type TextAnchor,
} from "../../src/models/thread";

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO_8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const testAnchor: TextAnchor = {
	anchorText: "test text",
	startOffset: 10,
	endOffset: 19,
	sectionHeading: "## Test Section",
};

describe("createThread", () => {
	it("produces a valid thread with UUID and ISO timestamp", () => {
		const thread = createThread({
			documentId: "doc.md",
			anchor: testAnchor,
		});

		expect(thread.id).toMatch(UUID_V4_REGEX);
		expect(thread.documentId).toBe("doc.md");
		expect(thread.anchor).toEqual(testAnchor);
		expect(thread.status).toBe("open");
		expect(thread.messages).toEqual([]);
		expect(thread.createdAt).toMatch(ISO_8601_REGEX);
		expect(thread.updatedAt).toMatch(ISO_8601_REGEX);
		expect(thread.createdAt).toBe(thread.updatedAt);
	});

	it("includes first message when provided", () => {
		const msg = createMessage({
			author: "remi",
			authorType: "human",
			content: "Hello",
		});

		const thread = createThread({
			documentId: "doc.md",
			anchor: testAnchor,
			firstMessage: msg,
		});

		expect(thread.messages).toHaveLength(1);
		expect(thread.messages[0]).toEqual(msg);
	});
});

describe("createMessage", () => {
	it("produces a valid message with UUID and ISO timestamp", () => {
		const msg = createMessage({
			author: "remi",
			authorType: "human",
			content: "Can you verify this?",
		});

		expect(msg.id).toMatch(UUID_V4_REGEX);
		expect(msg.author).toBe("remi");
		expect(msg.authorType).toBe("human");
		expect(msg.content).toBe("Can you verify this?");
		expect(msg.timestamp).toMatch(ISO_8601_REGEX);
		expect(msg.suggestion).toBeUndefined();
		expect(msg.knowledgeRefs).toBeUndefined();
	});

	it("includes suggestion when provided", () => {
		const suggestion = createSuggestion({
			originalText: "old text",
			replacementText: "new text",
		});

		const msg = createMessage({
			author: "WriterAgent",
			authorType: "agent",
			content: "Here's a rewrite",
			suggestion,
		});

		expect(msg.suggestion).toBeDefined();
		expect(msg.suggestion!.originalText).toBe("old text");
		expect(msg.suggestion!.replacementText).toBe("new text");
		expect(msg.suggestion!.status).toBe("pending");
	});

	it("includes knowledgeRefs when provided", () => {
		const msg = createMessage({
			author: "ResearchAgent",
			authorType: "agent",
			content: "Found sources",
			knowledgeRefs: ["research:paper-1", "research:paper-2"],
		});

		expect(msg.knowledgeRefs).toEqual(["research:paper-1", "research:paper-2"]);
	});

	it("omits empty knowledgeRefs array", () => {
		const msg = createMessage({
			author: "remi",
			authorType: "human",
			content: "Hello",
			knowledgeRefs: [],
		});

		expect(msg.knowledgeRefs).toBeUndefined();
	});
});

describe("createSuggestion", () => {
	it("creates a pending suggestion", () => {
		const suggestion = createSuggestion({
			originalText: "original",
			replacementText: "replacement",
		});

		expect(suggestion.originalText).toBe("original");
		expect(suggestion.replacementText).toBe("replacement");
		expect(suggestion.status).toBe("pending");
	});
});

describe("validateSidecarFile", () => {
	function validSidecar(): SidecarFile {
		return {
			version: 1,
			documentId: "doc.md",
			threads: [
				{
					id: "thread-1",
					documentId: "doc.md",
					anchor: {
						anchorText: "test",
						startOffset: 0,
						endOffset: 4,
					},
					status: "open",
					messages: [
						{
							id: "msg-1",
							author: "remi",
							authorType: "human",
							content: "Hello",
							timestamp: "2026-02-27T10:00:00.000Z",
						},
					],
					createdAt: "2026-02-27T10:00:00.000Z",
					updatedAt: "2026-02-27T10:00:00.000Z",
				},
			],
		};
	}

	it("accepts valid data", () => {
		const result = validateSidecarFile(validSidecar());
		expect(result.valid).toBe(true);
		expect(result.error).toBeUndefined();
	});

	it("rejects non-object data", () => {
		const result = validateSidecarFile("not an object");
		expect(result.valid).toBe(false);
	});

	it("rejects null", () => {
		const result = validateSidecarFile(null);
		expect(result.valid).toBe(false);
	});

	it("rejects missing version", () => {
		const data = validSidecar();
		// Cast to allow deletion for testing
		delete (data as Record<string, unknown>)["version"];
		const result = validateSidecarFile(data);
		expect(result.valid).toBe(false);
		expect(result.error).toContain("version");
	});

	it("rejects wrong version number", () => {
		const data = { ...validSidecar(), version: 99 };
		const result = validateSidecarFile(data);
		expect(result.valid).toBe(false);
		expect(result.error).toContain("99");
	});

	it("rejects missing threads array", () => {
		const data = { version: 1, documentId: "doc.md" };
		const result = validateSidecarFile(data);
		expect(result.valid).toBe(false);
		expect(result.error).toContain("threads");
	});

	it("rejects thread with missing id", () => {
		const data = validSidecar();
		delete (data.threads[0] as Record<string, unknown>)["id"];
		const result = validateSidecarFile(data);
		expect(result.valid).toBe(false);
		expect(result.error).toContain("id");
	});

	it("rejects message with invalid authorType", () => {
		const data = validSidecar();
		(data.threads[0]!.messages[0] as Record<string, unknown>)["authorType"] = "robot";
		const result = validateSidecarFile(data);
		expect(result.valid).toBe(false);
		expect(result.error).toContain("authorType");
	});

	it("rejects suggestion with invalid status", () => {
		const data = validSidecar();
		data.threads[0]!.messages[0]!.suggestion = {
			originalText: "a",
			replacementText: "b",
			status: "invalid" as "pending",
		};
		const result = validateSidecarFile(data);
		expect(result.valid).toBe(false);
		expect(result.error).toContain("status");
	});

	it("accepts data with extra keys (forward compatibility)", () => {
		const data = {
			...validSidecar(),
			extraField: "should be ignored",
		};
		const result = validateSidecarFile(data);
		expect(result.valid).toBe(true);
	});

	it("round-trips through JSON serialization", () => {
		const thread = createThread({
			documentId: "doc.md",
			anchor: testAnchor,
			firstMessage: createMessage({
				author: "remi",
				authorType: "human",
				content: "Hello",
				suggestion: createSuggestion({
					originalText: "old",
					replacementText: "new",
				}),
				knowledgeRefs: ["ref:1"],
			}),
		});

		const sidecar: SidecarFile = {
			version: 1,
			documentId: "doc.md",
			threads: [thread],
		};

		const json = JSON.stringify(sidecar);
		const parsed: unknown = JSON.parse(json);

		const result = validateSidecarFile(parsed);
		expect(result.valid).toBe(true);

		// Verify data is identical
		const roundTripped = parsed as SidecarFile;
		expect(roundTripped.threads[0]!.id).toBe(thread.id);
		expect(roundTripped.threads[0]!.messages[0]!.suggestion!.originalText).toBe("old");
		expect(roundTripped.threads[0]!.messages[0]!.knowledgeRefs).toEqual(["ref:1"]);
	});
});
