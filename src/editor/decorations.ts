/**
 * CM6 gutter decorations and anchor highlights.
 *
 * Gutter marks indicate lines with active threads.
 * Anchor highlights show the text range a thread is attached to.
 *
 * CSS is scoped to `.markdown-source-view` to prevent
 * leaking into Canvas/Kanban views (CriticMarkup #21).
 */

import {
	GutterMarker,
	gutter,
	Decoration,
	type DecorationSet,
	ViewPlugin,
	type ViewUpdate,
	type EditorView,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { threadStateField, showResolvedField } from "./state";
import type { CommentThread } from "../models/thread";

// --- Gutter Marker ---

class ThreadGutterMarker extends GutterMarker {
	private status: "open" | "resolved";

	private messageCount: number;

	constructor(status: "open" | "resolved", messageCount = 0) {
		super();
		this.status = status;
		this.messageCount = messageCount;
	}

	toDOM(): HTMLElement {
		const el = document.createElement("div");
		el.className = this.status === "open"
			? "agent-comments-gutter-dot agent-comments-gutter-open"
			: "agent-comments-gutter-dot agent-comments-gutter-resolved";
		const statusLabel = this.status === "open" ? "Open" : "Resolved";
		const msgLabel = this.messageCount === 1 ? "1 comment" : `${this.messageCount} comments`;
		el.setAttribute("aria-label", `${statusLabel} thread, ${msgLabel}`);
		return el;
	}

	override eq(other: GutterMarker): boolean {
		return other instanceof ThreadGutterMarker
			&& other.status === this.status
			&& other.messageCount === this.messageCount;
	}
}

// --- Gutter Extension ---

/**
 * Create the thread gutter extension.
 * @param onThreadClick Called when user clicks a gutter dot — receives the thread ID to reveal.
 */
export function createThreadGutter(onThreadClick: (threadId: string) => void) {
	return gutter({
		class: "agent-comments-gutter",
		markers(view) {
			const state = view.state.field(threadStateField, false);
			if (!state) {
				return new RangeSetBuilder<GutterMarker>().finish();
			}

			const showResolved = view.state.field(showResolvedField, false) ?? false;
			const builder = new RangeSetBuilder<GutterMarker>();
			const doc = view.state.doc;

			// Collect markers per line, sorted by position
			const lineMarkers: { line: number; marker: GutterMarker }[] = [];

			for (const thread of state.threads) {
				if (thread.status === "resolved" && !showResolved) continue;
				const { startOffset } = thread.anchor;
				if (startOffset >= 0 && startOffset <= doc.length) {
					const line = doc.lineAt(startOffset);
					lineMarkers.push({
						line: line.from,
						marker: new ThreadGutterMarker(thread.status, thread.messages.length),
					});
				}
			}

			// Sort by position (required for RangeSetBuilder)
			lineMarkers.sort((a, b) => a.line - b.line);

			// Deduplicate — one marker per line (prefer open over resolved)
			const seen = new Set<number>();
			for (const { line, marker } of lineMarkers) {
				if (!seen.has(line)) {
					seen.add(line);
					builder.add(line, line, marker);
				}
			}

			return builder.finish();
		},
		domEventHandlers: {
			click(view, line) {
				const state = view.state.field(threadStateField, false);
				if (!state) return false;

				const showResolved = view.state.field(showResolvedField, false) ?? false;
				const doc = view.state.doc;

				// Find threads anchored to this line — prefer open over resolved
				let bestThread: CommentThread | null = null;
				for (const thread of state.threads) {
					if (thread.status === "resolved" && !showResolved) continue;
					const { startOffset } = thread.anchor;
					if (startOffset >= 0 && startOffset <= doc.length) {
						const threadLine = doc.lineAt(startOffset);
						if (threadLine.from === line.from) {
							if (!bestThread || (bestThread.status === "resolved" && thread.status === "open")) {
								bestThread = thread;
							}
						}
					}
				}

				if (bestThread) {
					onThreadClick(bestThread.id);
					return true;
				}
				return false;
			},
		},
	});
}

// --- Anchor Highlight Decorations ---

const anchorHighlight = Decoration.mark({
	class: "agent-comments-anchor-highlight",
});

export const anchorHighlightPlugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = this.buildDecorations(view);
		}

		update(update: ViewUpdate): void {
			// Rebuild when thread state, resolved visibility, or document changed
			const oldState = update.startState.field(threadStateField, false);
			const newState = update.state.field(threadStateField, false);
			const oldShowResolved = update.startState.field(showResolvedField, false);
			const newShowResolved = update.state.field(showResolvedField, false);

			if (oldState !== newState || oldShowResolved !== newShowResolved || update.docChanged) {
				this.decorations = this.buildDecorations(update.view);
			}
		}

		private buildDecorations(view: EditorView): DecorationSet {
			const state = view.state.field(threadStateField, false);
			if (!state) return Decoration.none;

			const showResolved = view.state.field(showResolvedField, false) ?? false;
			const builder = new RangeSetBuilder<Decoration>();
			const doc = view.state.doc;

			// Collect all ranges, sorted by startOffset
			const ranges: { from: number; to: number; thread: CommentThread }[] = [];

			for (const thread of state.threads) {
				if (thread.status === "resolved" && !showResolved) continue;
				const { startOffset, endOffset } = thread.anchor;
				if (
					startOffset >= 0 &&
					endOffset <= doc.length &&
					startOffset < endOffset
				) {
					ranges.push({ from: startOffset, to: endOffset, thread });
				}
			}

			ranges.sort((a, b) => a.from - b.from || a.to - b.to);

			for (const { from, to } of ranges) {
				builder.add(from, to, anchorHighlight);
			}

			return builder.finish();
		}
	},
	{
		decorations: (v) => v.decorations,
	},
);
