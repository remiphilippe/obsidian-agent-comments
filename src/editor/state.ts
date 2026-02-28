/**
 * CM6 state management for thread data.
 *
 * Uses StateField + StateEffect pattern per Obsidian conventions.
 * Never mutates state directly — effects are the only way to update.
 */

import { StateField, StateEffect } from "@codemirror/state";
import type { CommentThread } from "../models/thread";

// --- State Effects ---

export const setThreadsEffect = StateEffect.define<CommentThread[]>();
export const addThreadEffect = StateEffect.define<CommentThread>();
export const updateThreadEffect = StateEffect.define<CommentThread>();
export const removeThreadEffect = StateEffect.define<string>(); // thread ID
export const setShowResolvedEffect = StateEffect.define<boolean>();

// --- State ---

export interface ThreadEditorState {
	threads: CommentThread[];
	orphaned: CommentThread[];
}

const EMPTY_STATE: ThreadEditorState = {
	threads: [],
	orphaned: [],
};

// --- Show Resolved Field ---

export const showResolvedField = StateField.define<boolean>({
	create() {
		return false;
	},

	update(state, transaction) {
		for (const effect of transaction.effects) {
			if (effect.is(setShowResolvedEffect)) {
				return effect.value;
			}
		}
		return state;
	},
});

// --- State Field ---

export const threadStateField = StateField.define<ThreadEditorState>({
	create() {
		return EMPTY_STATE;
	},

	update(state, transaction) {
		let newState = state;

		for (const effect of transaction.effects) {
			if (effect.is(setThreadsEffect)) {
				newState = {
					threads: effect.value,
					orphaned: [],
				};
			} else if (effect.is(addThreadEffect)) {
				newState = {
					...newState,
					threads: [...newState.threads, effect.value],
				};
			} else if (effect.is(updateThreadEffect)) {
				const updated = effect.value;
				const idx = newState.threads.findIndex((t) => t.id === updated.id);
				if (idx >= 0) {
					const threads = [...newState.threads];
					threads[idx] = updated;
					newState = { ...newState, threads };
				}
			} else if (effect.is(removeThreadEffect)) {
				const id = effect.value;
				const threads = newState.threads.filter((t) => t.id !== id);
				if (threads.length !== newState.threads.length) {
					newState = { ...newState, threads };
				}
			}
		}

		return newState;
	},
});
