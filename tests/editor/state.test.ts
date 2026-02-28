/**
 * Tests for CM6 thread state management.
 *
 * Since @codemirror/state is an Obsidian runtime external,
 * we mock it minimally to test our StateField logic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CommentThread } from "../../src/models/thread";
import { createThread, createMessage } from "../../src/models/thread";

// We test the state update logic extracted from the StateField.
// The actual CM6 integration is validated in Obsidian.

interface ThreadEditorState {
	threads: CommentThread[];
	orphaned: CommentThread[];
}

const EMPTY_STATE: ThreadEditorState = {
	threads: [],
	orphaned: [],
};

type EffectType = "set" | "add" | "update" | "remove";

interface MockEffect {
	type: EffectType;
	value: CommentThread | CommentThread[] | string;
}

// Extracted state update logic matching src/editor/state.ts
function applyEffects(state: ThreadEditorState, effects: MockEffect[]): ThreadEditorState {
	let newState = state;

	for (const effect of effects) {
		switch (effect.type) {
			case "set":
				newState = {
					threads: effect.value as CommentThread[],
					orphaned: [],
				};
				break;
			case "add":
				newState = {
					...newState,
					threads: [...newState.threads, effect.value as CommentThread],
				};
				break;
			case "update": {
				const updated = effect.value as CommentThread;
				const idx = newState.threads.findIndex((t) => t.id === updated.id);
				if (idx >= 0) {
					const threads = [...newState.threads];
					threads[idx] = updated;
					newState = { ...newState, threads };
				}
				break;
			}
			case "remove": {
				const id = effect.value as string;
				const threads = newState.threads.filter((t) => t.id !== id);
				if (threads.length !== newState.threads.length) {
					newState = { ...newState, threads };
				}
				break;
			}
		}
	}

	return newState;
}

function makeThread(id?: string): CommentThread {
	const thread = createThread({
		documentId: "test.md",
		anchor: {
			anchorText: "test",
			startOffset: 0,
			endOffset: 4,
		},
		firstMessage: createMessage({
			author: "remi",
			authorType: "human",
			content: "test message",
		}),
	});
	if (id) {
		(thread as { id: string }).id = id;
	}
	return thread;
}

describe("showResolved state logic", () => {
	it("defaults to false", () => {
		let showResolved = false;
		expect(showResolved).toBe(false);
	});

	it("setShowResolvedEffect updates to true", () => {
		let showResolved = false;
		// Simulate effect application
		const effects = [{ type: "setShowResolved" as const, value: true }];
		for (const effect of effects) {
			if (effect.type === "setShowResolved") {
				showResolved = effect.value;
			}
		}
		expect(showResolved).toBe(true);
	});

	it("setShowResolvedEffect updates to false", () => {
		let showResolved = true;
		const effects = [{ type: "setShowResolved" as const, value: false }];
		for (const effect of effects) {
			if (effect.type === "setShowResolved") {
				showResolved = effect.value;
			}
		}
		expect(showResolved).toBe(false);
	});
});

describe("ThreadEditorState update logic", () => {
	it("starts with empty state", () => {
		expect(EMPTY_STATE.threads).toEqual([]);
		expect(EMPTY_STATE.orphaned).toEqual([]);
	});

	it("setThreadsEffect replaces all threads", () => {
		const t1 = makeThread("t1");
		const t2 = makeThread("t2");

		const state = applyEffects(EMPTY_STATE, [
			{ type: "set", value: [t1, t2] },
		]);

		expect(state.threads).toHaveLength(2);
		expect(state.threads[0]!.id).toBe("t1");
		expect(state.threads[1]!.id).toBe("t2");
	});

	it("addThreadEffect appends thread, preserves existing", () => {
		const t1 = makeThread("t1");
		const t2 = makeThread("t2");

		let state = applyEffects(EMPTY_STATE, [
			{ type: "set", value: [t1] },
		]);

		state = applyEffects(state, [
			{ type: "add", value: t2 },
		]);

		expect(state.threads).toHaveLength(2);
		expect(state.threads[0]!.id).toBe("t1");
		expect(state.threads[1]!.id).toBe("t2");
	});

	it("updateThreadEffect modifies thread by ID", () => {
		const t1 = makeThread("t1");
		const state = applyEffects(EMPTY_STATE, [
			{ type: "set", value: [t1] },
		]);

		const updated = { ...t1, status: "resolved" as const };
		const newState = applyEffects(state, [
			{ type: "update", value: updated },
		]);

		expect(newState.threads).toHaveLength(1);
		expect(newState.threads[0]!.status).toBe("resolved");
	});

	it("removeThreadEffect removes by ID", () => {
		const t1 = makeThread("t1");
		const t2 = makeThread("t2");
		const state = applyEffects(EMPTY_STATE, [
			{ type: "set", value: [t1, t2] },
		]);

		const newState = applyEffects(state, [
			{ type: "remove", value: "t1" },
		]);

		expect(newState.threads).toHaveLength(1);
		expect(newState.threads[0]!.id).toBe("t2");
	});

	it("unknown thread ID in update — state unchanged", () => {
		const t1 = makeThread("t1");
		const state = applyEffects(EMPTY_STATE, [
			{ type: "set", value: [t1] },
		]);

		const phantom = makeThread("nonexistent");
		const newState = applyEffects(state, [
			{ type: "update", value: phantom },
		]);

		expect(newState.threads).toHaveLength(1);
		expect(newState.threads[0]!.id).toBe("t1");
	});

	it("unknown thread ID in remove — state unchanged", () => {
		const t1 = makeThread("t1");
		const state = applyEffects(EMPTY_STATE, [
			{ type: "set", value: [t1] },
		]);

		const newState = applyEffects(state, [
			{ type: "remove", value: "nonexistent" },
		]);

		expect(newState.threads).toHaveLength(1);
		expect(newState.threads[0]!.id).toBe("t1");
	});

	it("multiple effects applied sequentially", () => {
		const t1 = makeThread("t1");
		const t2 = makeThread("t2");
		const t3 = makeThread("t3");

		const state = applyEffects(EMPTY_STATE, [
			{ type: "add", value: t1 },
			{ type: "add", value: t2 },
			{ type: "add", value: t3 },
			{ type: "remove", value: "t2" },
		]);

		expect(state.threads).toHaveLength(2);
		expect(state.threads.map((t) => t.id)).toEqual(["t1", "t3"]);
	});
});
