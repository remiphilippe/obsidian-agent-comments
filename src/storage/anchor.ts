/**
 * Anchor resolution engine.
 *
 * Triple-layer anchoring for resilience across edits:
 * 1. Exact offset match (fast path)
 * 2. anchorText text search (survives minor edits)
 * 3. sectionHeading fallback (survives refactors)
 *
 * Uses @flatten-js/interval-tree for O(log n) range queries.
 */

import IntervalTree from "@flatten-js/interval-tree";
import type { CommentThread, TextAnchor } from "../models/thread";

export interface ResolvedAnchor {
	startOffset: number;
	endOffset: number;
	method: "exact" | "text-search" | "heading-fallback";
}

export interface AnchorUpdateResult {
	updated: CommentThread[];
	orphaned: CommentThread[];
}

/**
 * Wraps an interval tree for O(log n) range queries and offset updates.
 */
export class AnchorIndex {
	private tree: IntervalTree;
	private threadMap = new Map<string, CommentThread>();

	constructor() {
		this.tree = new IntervalTree();
	}

	/**
	 * Populate the tree from an array of threads.
	 */
	build(threads: CommentThread[]): void {
		this.tree = new IntervalTree();
		this.threadMap.clear();

		for (const thread of threads) {
			const { startOffset, endOffset } = thread.anchor;
			if (startOffset < endOffset) {
				this.tree.insert([startOffset, endOffset], thread.id);
			}
			this.threadMap.set(thread.id, thread);
		}
	}

	/**
	 * Find all threads that overlap with a given offset.
	 */
	query(offset: number): CommentThread[] {
		const results = this.tree.search([offset, offset]) as string[];
		return results
			.map((id) => this.threadMap.get(id))
			.filter((t): t is CommentThread => t !== undefined);
	}

	/**
	 * Update all ranges after a document change using in-place anchor
	 * shifting and interval tree rebuild. Avoids cascading recalculation.
	 */
	applyOffsetShift(changeFrom: number, changeTo: number, insertLength: number): void {
		const delta = insertLength - (changeTo - changeFrom);
		if (delta === 0) return;

		// Rebuild tree with shifted offsets
		const threads = Array.from(this.threadMap.values());
		for (const thread of threads) {
			const anchor = thread.anchor;
			if (anchor.startOffset >= changeTo) {
				// Anchor is entirely after the change — shift both offsets
				anchor.startOffset += delta;
				anchor.endOffset += delta;
			} else if (anchor.startOffset >= changeFrom && anchor.endOffset <= changeTo) {
				// Anchor is entirely within the changed region — will be re-resolved
				// Leave it as-is for now; resolveAnchor will handle it
			} else if (anchor.endOffset > changeFrom) {
				// Anchor overlaps with the change — adjust end offset
				anchor.endOffset = Math.max(anchor.startOffset, anchor.endOffset + delta);
			}
		}

		// Rebuild the interval tree with updated offsets
		this.build(threads);
	}
}

/**
 * Resolves an anchor against the current document content.
 * Uses three layers of resolution:
 * 1. Exact offset match
 * 2. Text search (indexOf, closest to original offset)
 * 3. Section heading fallback
 */
export function resolveAnchor(
	anchor: TextAnchor,
	documentContent: string,
): ResolvedAnchor | null {
	if (documentContent.length === 0) {
		return null;
	}

	// Layer 1: Exact offset match
	const { startOffset, endOffset, anchorText } = anchor;
	if (
		startOffset >= 0 &&
		endOffset <= documentContent.length &&
		startOffset < endOffset &&
		documentContent.slice(startOffset, endOffset) === anchorText
	) {
		return { startOffset, endOffset, method: "exact" };
	}

	// Layer 2: Text search — find anchorText, prefer match closest to original offset
	const textResult = findClosestMatch(anchorText, documentContent, startOffset);
	if (textResult !== null) {
		return {
			startOffset: textResult,
			endOffset: textResult + anchorText.length,
			method: "text-search",
		};
	}

	// Layer 3: Section heading fallback
	if (anchor.sectionHeading) {
		const headingResult = resolveViaHeading(
			anchorText,
			documentContent,
			anchor.sectionHeading,
		);
		if (headingResult !== null) {
			return {
				startOffset: headingResult,
				endOffset: headingResult + anchorText.length,
				method: "heading-fallback",
			};
		}
	}

	// All layers failed — anchor is orphaned
	return null;
}

/**
 * Finds the closest occurrence of `needle` in `haystack` to `preferredOffset`.
 * Returns the start offset of the closest match, or null if not found.
 */
function findClosestMatch(
	needle: string,
	haystack: string,
	preferredOffset: number,
): number | null {
	if (needle.length === 0) return null;

	let bestOffset: number | null = null;
	let bestDistance = Infinity;
	let searchFrom = 0;

	while (searchFrom <= haystack.length - needle.length) {
		const idx = haystack.indexOf(needle, searchFrom);
		if (idx === -1) break;

		const distance = Math.abs(idx - preferredOffset);
		if (distance < bestDistance) {
			bestDistance = distance;
			bestOffset = idx;
		}

		searchFrom = idx + 1;
	}

	return bestOffset;
}

/**
 * Resolves anchor text by finding the section heading first,
 * then searching for anchor text near that heading.
 */
function resolveViaHeading(
	anchorText: string,
	documentContent: string,
	sectionHeading: string,
): number | null {
	// Find the heading in the document
	const headingIdx = documentContent.indexOf(sectionHeading);
	if (headingIdx === -1) return null;

	// Find the end of this section (next heading of same or higher level, or end of doc)
	const headingLevel = sectionHeading.match(/^#+/)?.[0]?.length ?? 1;
	const headingPattern = new RegExp(`^#{1,${headingLevel}} `, "m");
	const afterHeading = documentContent.slice(headingIdx + sectionHeading.length);
	const nextHeadingMatch = headingPattern.exec(afterHeading);
	const sectionEnd = nextHeadingMatch
		? headingIdx + sectionHeading.length + nextHeadingMatch.index
		: documentContent.length;

	// Search for anchor text within this section
	const sectionContent = documentContent.slice(headingIdx, sectionEnd);
	const localIdx = sectionContent.indexOf(anchorText);
	if (localIdx === -1) return null;

	return headingIdx + localIdx;
}

/**
 * Updates all thread anchors against new document content.
 * Returns updated threads (with new offsets) and orphaned threads.
 */
export function updateAnchors(
	threads: CommentThread[],
	_oldContent: string,
	newContent: string,
): AnchorUpdateResult {
	const updated: CommentThread[] = [];
	const orphaned: CommentThread[] = [];

	for (const thread of threads) {
		const resolved = resolveAnchor(thread.anchor, newContent);
		if (resolved) {
			// Update anchor offsets
			thread.anchor.startOffset = resolved.startOffset;
			thread.anchor.endOffset = resolved.endOffset;
			updated.push(thread);
		} else {
			orphaned.push(thread);
		}
	}

	return { updated, orphaned };
}

/**
 * Extracts the nearest markdown heading above a given offset.
 * Returns the full heading line (e.g., "## Results") or undefined.
 */
export function extractSectionHeading(
	documentContent: string,
	offset: number,
): string | undefined {
	// Search backwards from offset for the nearest heading
	const contentBefore = documentContent.slice(0, offset);
	const headingRegex = /^(#{1,6} .+)$/gm;
	let lastMatch: string | undefined;

	let match: RegExpExecArray | null;
	while ((match = headingRegex.exec(contentBefore)) !== null) {
		lastMatch = match[1];
	}

	return lastMatch;
}
