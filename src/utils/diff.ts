/**
 * Text diff utilities for suggestion rendering.
 * Wraps the diff-match-patch library for semantic diffs.
 */

import DiffMatchPatch from "diff-match-patch";

export interface DiffSegment {
	type: "equal" | "insert" | "delete";
	text: string;
}

const dmp = new DiffMatchPatch();

/**
 * Computes a semantic diff between original and replacement text.
 * Returns an array of segments suitable for rendering inline diffs.
 *
 * Uses `diff_cleanupSemantic()` for human-readable diffs
 * (avoids character-level noise).
 */
export function computeDiff(original: string, replacement: string): DiffSegment[] {
	const diffs = dmp.diff_main(original, replacement);
	dmp.diff_cleanupSemantic(diffs);

	return diffs.map(([op, text]) => {
		let type: DiffSegment["type"];
		switch (op) {
			case DiffMatchPatch.DIFF_EQUAL:
				type = "equal";
				break;
			case DiffMatchPatch.DIFF_INSERT:
				type = "insert";
				break;
			case DiffMatchPatch.DIFF_DELETE:
				type = "delete";
				break;
			default:
				type = "equal";
		}
		return { type, text };
	});
}
