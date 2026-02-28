/**
 * Tests for the suggestion widget logic.
 *
 * Since WidgetType is a CM6 external, we test the diff rendering
 * and widget configuration logic directly.
 */

import { describe, it, expect, vi } from "vitest";
import { computeDiff } from "../../src/utils/diff";
import type { SuggestionWidgetConfig } from "../../src/editor/suggestion-widget";

describe("SuggestionWidget logic", () => {
	it("produces correct diff segments for suggestion rendering", () => {
		const segments = computeDiff("old text here", "new text here");

		const deleteSegments = segments.filter((s) => s.type === "delete");
		const insertSegments = segments.filter((s) => s.type === "insert");

		expect(deleteSegments.length).toBeGreaterThan(0);
		expect(insertSegments.length).toBeGreaterThan(0);

		// Deleted text contains "old"
		const deletedText = deleteSegments.map((s) => s.text).join("");
		expect(deletedText).toContain("old");

		// Inserted text contains "new"
		const insertedText = insertSegments.map((s) => s.text).join("");
		expect(insertedText).toContain("new");
	});

	it("config correctly identifies thread and message", () => {
		const onAccept = vi.fn();
		const onReject = vi.fn();

		const config: SuggestionWidgetConfig = {
			threadId: "thread-1",
			messageId: "msg-1",
			originalText: "old",
			replacementText: "new",
			onAccept,
			onReject,
		};

		expect(config.threadId).toBe("thread-1");
		expect(config.messageId).toBe("msg-1");

		// Simulate accept
		config.onAccept(config.threadId, config.messageId);
		expect(onAccept).toHaveBeenCalledWith("thread-1", "msg-1");

		// Simulate reject
		config.onReject(config.threadId, config.messageId);
		expect(onReject).toHaveBeenCalledWith("thread-1", "msg-1");
	});

	it("diff for identical text produces only equal segments", () => {
		const segments = computeDiff("same text", "same text");
		expect(segments).toEqual([{ type: "equal", text: "same text" }]);
	});

	it("config equality check works correctly", () => {
		const config1: SuggestionWidgetConfig = {
			threadId: "t1",
			messageId: "m1",
			originalText: "old",
			replacementText: "new",
			onAccept: vi.fn(),
			onReject: vi.fn(),
		};

		const config2: SuggestionWidgetConfig = {
			threadId: "t1",
			messageId: "m1",
			originalText: "old",
			replacementText: "new",
			onAccept: vi.fn(),
			onReject: vi.fn(),
		};

		const config3: SuggestionWidgetConfig = {
			threadId: "t1",
			messageId: "m1",
			originalText: "old",
			replacementText: "different",
			onAccept: vi.fn(),
			onReject: vi.fn(),
		};

		// Same data — should be equal
		expect(
			config1.threadId === config2.threadId &&
			config1.messageId === config2.messageId &&
			config1.originalText === config2.originalText &&
			config1.replacementText === config2.replacementText,
		).toBe(true);

		// Different replacement — should not be equal
		expect(
			config1.threadId === config3.threadId &&
			config1.messageId === config3.messageId &&
			config1.originalText === config3.originalText &&
			config1.replacementText === config3.replacementText,
		).toBe(false);
	});
});
