import { describe, it, expect } from "vitest";
import { computeDiff } from "../../src/utils/diff";

describe("computeDiff", () => {
	it("returns single equal segment for identical strings", () => {
		const result = computeDiff("hello world", "hello world");
		expect(result).toEqual([{ type: "equal", text: "hello world" }]);
	});

	it("handles pure insertion", () => {
		const result = computeDiff("hello world", "hello beautiful world");
		// Should have equal, insert, equal segments
		const types = result.map((s) => s.type);
		expect(types).toContain("equal");
		expect(types).toContain("insert");

		// Verify the insertion text is present
		const insertSegments = result.filter((s) => s.type === "insert");
		const insertedText = insertSegments.map((s) => s.text).join("");
		expect(insertedText).toContain("beautiful ");
	});

	it("handles pure deletion", () => {
		const result = computeDiff("hello beautiful world", "hello world");
		const types = result.map((s) => s.type);
		expect(types).toContain("equal");
		expect(types).toContain("delete");

		const deleteSegments = result.filter((s) => s.type === "delete");
		const deletedText = deleteSegments.map((s) => s.text).join("");
		expect(deletedText).toContain("beautiful ");
	});

	it("handles replacement (delete + insert)", () => {
		const result = computeDiff("the quick brown fox", "the slow brown fox");
		const types = result.map((s) => s.type);
		expect(types).toContain("delete");
		expect(types).toContain("insert");

		const deleted = result.filter((s) => s.type === "delete").map((s) => s.text).join("");
		const inserted = result.filter((s) => s.type === "insert").map((s) => s.text).join("");
		expect(deleted).toContain("quick");
		expect(inserted).toContain("slow");
	});

	it("handles empty original (pure insertion)", () => {
		const result = computeDiff("", "new text");
		expect(result).toEqual([{ type: "insert", text: "new text" }]);
	});

	it("handles empty replacement (pure deletion)", () => {
		const result = computeDiff("old text", "");
		expect(result).toEqual([{ type: "delete", text: "old text" }]);
	});

	it("handles multi-line diff correctly", () => {
		const original = "line 1\nline 2\nline 3";
		const replacement = "line 1\nmodified line 2\nline 3";

		const result = computeDiff(original, replacement);

		// Reconstruct original and replacement from segments
		const originalFromDiff = result
			.filter((s) => s.type !== "insert")
			.map((s) => s.text)
			.join("");
		const replacementFromDiff = result
			.filter((s) => s.type !== "delete")
			.map((s) => s.text)
			.join("");

		expect(originalFromDiff).toBe(original);
		expect(replacementFromDiff).toBe(replacement);
	});
});
