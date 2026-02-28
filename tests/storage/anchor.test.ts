import { describe, it, expect } from "vitest";
import {
	AnchorIndex,
	resolveAnchor,
	updateAnchors,
	extractSectionHeading,
} from "../../src/storage/anchor";
import type { CommentThread, TextAnchor } from "../../src/models/thread";
import { createThread, createMessage } from "../../src/models/thread";

function makeThread(anchor: TextAnchor, id?: string): CommentThread {
	const thread = createThread({
		documentId: "test.md",
		anchor,
		firstMessage: createMessage({
			author: "remi",
			authorType: "human",
			content: "test",
		}),
	});
	if (id) {
		(thread as { id: string }).id = id;
	}
	return thread;
}

describe("resolveAnchor", () => {
	it("resolves by exact offset on unmodified document", () => {
		const doc = "Hello, this is a test document.";
		const anchor: TextAnchor = {
			anchorText: "test",
			startOffset: 17,
			endOffset: 21,
		};

		const result = resolveAnchor(anchor, doc);
		expect(result).not.toBeNull();
		expect(result!.startOffset).toBe(17);
		expect(result!.endOffset).toBe(21);
		expect(result!.method).toBe("exact");
	});

	it("uses text-search when insertion shifts text forward", () => {
		const originalDoc = "Hello, this is a test document.";
		const modifiedDoc = "Hello world, this is a test document.";
		// "test" was at offset 17, now at 23
		const anchor: TextAnchor = {
			anchorText: "test",
			startOffset: 17,
			endOffset: 21,
		};

		const result = resolveAnchor(anchor, modifiedDoc);
		expect(result).not.toBeNull();
		expect(result!.method).toBe("text-search");
		expect(modifiedDoc.slice(result!.startOffset, result!.endOffset)).toBe("test");
	});

	it("uses text-search when deletion shifts text backward", () => {
		const modifiedDoc = "this is a test document.";
		// "test" was at offset 17 in original, now at 10
		const anchor: TextAnchor = {
			anchorText: "test",
			startOffset: 17,
			endOffset: 21,
		};

		const result = resolveAnchor(anchor, modifiedDoc);
		expect(result).not.toBeNull();
		expect(result!.method).toBe("text-search");
		expect(modifiedDoc.slice(result!.startOffset, result!.endOffset)).toBe("test");
	});

	it("uses heading fallback when anchorText appears multiple times", () => {
		const doc = [
			"# Introduction",
			"This has a test word.",
			"",
			"## Results",
			"This also has a test word.",
		].join("\n");

		const anchor: TextAnchor = {
			anchorText: "test",
			startOffset: 999, // wrong offset
			endOffset: 1003,
			sectionHeading: "## Results",
		};

		const result = resolveAnchor(anchor, doc);
		expect(result).not.toBeNull();
		// Should find the "test" in the Results section
		const foundText = doc.slice(result!.startOffset, result!.endOffset);
		expect(foundText).toBe("test");
		// Verify it's in the Results section (after "## Results")
		const resultsIdx = doc.indexOf("## Results");
		expect(result!.startOffset).toBeGreaterThan(resultsIdx);
	});

	it("returns null when anchorText is deleted entirely (orphaned)", () => {
		const doc = "Hello, this is a document.";
		const anchor: TextAnchor = {
			anchorText: "unique_text_not_found",
			startOffset: 0,
			endOffset: 21,
		};

		const result = resolveAnchor(anchor, doc);
		expect(result).toBeNull();
	});

	it("resolves multiple anchors in same section independently", () => {
		const doc = "## Section\nFirst anchor text and second anchor text.";
		const anchor1: TextAnchor = {
			anchorText: "First anchor text",
			startOffset: 11,
			endOffset: 28,
		};
		const anchor2: TextAnchor = {
			anchorText: "second anchor text",
			startOffset: 33,
			endOffset: 51,
		};

		const result1 = resolveAnchor(anchor1, doc);
		const result2 = resolveAnchor(anchor2, doc);

		expect(result1).not.toBeNull();
		expect(result2).not.toBeNull();
		expect(doc.slice(result1!.startOffset, result1!.endOffset)).toBe("First anchor text");
		expect(doc.slice(result2!.startOffset, result2!.endOffset)).toBe("second anchor text");
	});

	it("resolves anchor at offset 0", () => {
		const doc = "Starting text of the document.";
		const anchor: TextAnchor = {
			anchorText: "Starting",
			startOffset: 0,
			endOffset: 8,
		};

		const result = resolveAnchor(anchor, doc);
		expect(result).not.toBeNull();
		expect(result!.startOffset).toBe(0);
		expect(result!.method).toBe("exact");
	});

	it("resolves anchor at end of document", () => {
		const doc = "Text at end";
		const anchor: TextAnchor = {
			anchorText: "end",
			startOffset: 8,
			endOffset: 11,
		};

		const result = resolveAnchor(anchor, doc);
		expect(result).not.toBeNull();
		expect(result!.endOffset).toBe(doc.length);
		expect(result!.method).toBe("exact");
	});

	it("returns null for empty document", () => {
		const anchor: TextAnchor = {
			anchorText: "anything",
			startOffset: 0,
			endOffset: 8,
		};

		const result = resolveAnchor(anchor, "");
		expect(result).toBeNull();
	});

	it("anchorText in multiple sections — sectionHeading picks correct one", () => {
		const doc = [
			"# Section A",
			"The word target appears here.",
			"",
			"# Section B",
			"The word target appears here too.",
		].join("\n");

		const anchor: TextAnchor = {
			anchorText: "target",
			startOffset: 999,
			endOffset: 1005,
			sectionHeading: "# Section B",
		};

		const result = resolveAnchor(anchor, doc);
		expect(result).not.toBeNull();
		// Should resolve in Section B
		const sectionBStart = doc.indexOf("# Section B");
		expect(result!.startOffset).toBeGreaterThan(sectionBStart);
	});

	it("does not false-match on partial substring", () => {
		const doc = "testing the tester for testability";
		const anchor: TextAnchor = {
			anchorText: "unique_full_text_not_in_doc",
			startOffset: 0,
			endOffset: 26,
		};

		const result = resolveAnchor(anchor, doc);
		expect(result).toBeNull();
	});
});

describe("updateAnchors", () => {
	it("returns updated threads with resolved anchors", () => {
		const doc = "Hello, this is a test document.";
		const thread = makeThread({
			anchorText: "test",
			startOffset: 17,
			endOffset: 21,
		});

		const result = updateAnchors([thread], doc, doc);
		expect(result.updated).toHaveLength(1);
		expect(result.orphaned).toHaveLength(0);
	});

	it("returns orphaned threads when text is deleted", () => {
		const oldDoc = "Hello, this is a test document.";
		const newDoc = "Hello, this is a document.";
		const thread = makeThread({
			anchorText: "test ",
			startOffset: 17,
			endOffset: 22,
		});

		const result = updateAnchors([thread], oldDoc, newDoc);
		expect(result.updated).toHaveLength(0);
		expect(result.orphaned).toHaveLength(1);
	});

	it("updates anchor offsets when text shifts", () => {
		const oldDoc = "Hello, test document.";
		const newDoc = "Hello world, test document.";
		const thread = makeThread({
			anchorText: "test",
			startOffset: 7,
			endOffset: 11,
		});

		const result = updateAnchors([thread], oldDoc, newDoc);
		expect(result.updated).toHaveLength(1);
		expect(result.updated[0]!.anchor.startOffset).toBe(13);
		expect(result.updated[0]!.anchor.endOffset).toBe(17);
	});
});

describe("extractSectionHeading", () => {
	it("finds the nearest heading above an offset", () => {
		const doc = "# Title\n\nSome text\n\n## Section\n\nMore text here.";
		const offset = doc.indexOf("More text");
		const heading = extractSectionHeading(doc, offset);
		expect(heading).toBe("## Section");
	});

	it("returns first heading when offset is in first section", () => {
		const doc = "# Title\n\nSome text here.";
		const offset = doc.indexOf("Some text");
		const heading = extractSectionHeading(doc, offset);
		expect(heading).toBe("# Title");
	});

	it("returns undefined when no heading exists", () => {
		const doc = "No headings in this document.";
		const heading = extractSectionHeading(doc, 10);
		expect(heading).toBeUndefined();
	});
});

describe("AnchorIndex", () => {
	it("builds and queries threads by offset", () => {
		const thread1 = makeThread(
			{ anchorText: "hello", startOffset: 0, endOffset: 5 },
			"t1",
		);
		const thread2 = makeThread(
			{ anchorText: "world", startOffset: 10, endOffset: 15 },
			"t2",
		);

		const index = new AnchorIndex();
		index.build([thread1, thread2]);

		const atZero = index.query(2);
		expect(atZero).toHaveLength(1);
		expect(atZero[0]!.id).toBe("t1");

		const atTen = index.query(12);
		expect(atTen).toHaveLength(1);
		expect(atTen[0]!.id).toBe("t2");

		const atGap = index.query(7);
		expect(atGap).toHaveLength(0);
	});

	it("applies offset shift for insertions after a position", () => {
		const thread = makeThread(
			{ anchorText: "target", startOffset: 20, endOffset: 26 },
			"t1",
		);

		const index = new AnchorIndex();
		index.build([thread]);

		// Insertion of 5 chars at position 10
		index.applyOffsetShift(10, 10, 5);

		const results = index.query(25); // 20 + 5 = 25
		expect(results).toHaveLength(1);
		expect(results[0]!.anchor.startOffset).toBe(25);
		expect(results[0]!.anchor.endOffset).toBe(31);
	});
});
