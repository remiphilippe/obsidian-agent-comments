/**
 * Mock session generator for testing the plugin UI.
 *
 * Creates realistic comment threads anchored to actual content
 * in the current document. Covers all thread/suggestion states
 * so every UI path can be exercised.
 */

import { MarkdownView, TFile } from "obsidian";
import type { CommentThread, TextAnchor, ThreadMessage, Suggestion } from "../models/thread";
import { generateId } from "../utils/ids";
import type { SidecarStorage } from "../storage/sidecar";
import { extractSectionHeading } from "../storage/anchor";

// --- Helpers ---

/** Create a timestamp offset from now by `minutesAgo` minutes. */
function pastISO(minutesAgo: number): string {
	return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

function msg(
	author: string,
	authorType: "human" | "agent",
	content: string,
	minutesAgo: number,
	extra?: { suggestion?: Suggestion; knowledgeRefs?: string[] },
): ThreadMessage {
	return {
		id: generateId(),
		author,
		authorType,
		content,
		timestamp: pastISO(minutesAgo),
		...(extra?.suggestion ? { suggestion: extra.suggestion } : {}),
		...(extra?.knowledgeRefs ? { knowledgeRefs: extra.knowledgeRefs } : {}),
	};
}

function thread(
	documentId: string,
	anchor: TextAnchor,
	status: "open" | "resolved",
	messages: ThreadMessage[],
	minutesAgo: number,
): CommentThread {
	return {
		id: generateId(),
		documentId,
		anchor,
		status,
		messages,
		createdAt: pastISO(minutesAgo),
		updatedAt: pastISO(Math.min(...messages.map((m) => parseMinutesAgo(m.timestamp)))),
	};
}

function parseMinutesAgo(iso: string): number {
	return Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
}

// --- Anchor extraction ---

interface AnchorCandidate {
	anchorText: string;
	startOffset: number;
	endOffset: number;
	sectionHeading?: string;
}

/**
 * Scan the document for anchoring candidates — non-empty lines
 * that are long enough to be meaningful anchors (>=10 chars).
 * Uses line-based splitting to avoid breaking on URLs or markdown syntax.
 * Returns up to `count` candidates spread across the document.
 */
function findAnchors(content: string, count: number): AnchorCandidate[] {
	const lines = content.split("\n");
	const candidates: AnchorCandidate[] = [];
	let offset = 0;

	for (const line of lines) {
		const trimmed = line.trim();
		// Skip headings, blank lines, and very short lines
		if (trimmed.length >= 10 && !trimmed.startsWith("#")) {
			// Strip leading list markers (- , * , 1. ) for cleaner anchors
			const bodyMatch = /^(?:[-*+]|\d+\.)\s+/.exec(trimmed);
			const body = bodyMatch ? trimmed.slice(bodyMatch[0].length) : trimmed;
			const bodyOffset = bodyMatch
				? offset + line.indexOf(trimmed) + bodyMatch[0].length
				: offset + line.indexOf(trimmed);

			if (body.length >= 10) {
				candidates.push({
					anchorText: body,
					startOffset: bodyOffset,
					endOffset: bodyOffset + body.length,
					sectionHeading: extractSectionHeading(content, offset),
				});
			}
		}
		offset += line.length + 1; // +1 for the \n
	}

	if (candidates.length === 0) return [];

	// Spread picks evenly across the document
	const step = Math.max(1, Math.floor(candidates.length / count));
	const picks: AnchorCandidate[] = [];
	for (let i = 0; i < candidates.length && picks.length < count; i += step) {
		picks.push(candidates[i]!);
	}
	return picks;
}

// --- Mock thread generators ---

function makeConversationThread(docId: string, anchor: AnchorCandidate): CommentThread {
	return thread(docId, anchor, "open", [
		msg("You", "human", "This paragraph could use more detail. Can you expand on the key points?", 45),
		msg("Claude", "agent", "Sure — I think we could add context about the underlying motivation and a concrete example. Want me to draft something?", 42),
		msg("You", "human", "Yes, go ahead. Keep it concise though.", 40),
		msg("Claude", "agent", "Here's a draft expansion. Let me know if you'd like to adjust the tone or add anything else.", 38),
	], 45);
}

function makeSuggestionThread(docId: string, anchor: AnchorCandidate): CommentThread {
	const anchorText = anchor.anchorText;
	// Create a plausible rewrite of the anchor text
	const replacementText = anchorText
		.replace(/\bvery\b/gi, "particularly")
		.replace(/\bgood\b/gi, "effective")
		.replace(/\bbad\b/gi, "suboptimal")
		.replace(/\bthis\b/i, "the following");

	// Only suggest if we actually changed something
	const suggestion: Suggestion = anchorText !== replacementText
		? { originalText: anchorText, replacementText, status: "pending" as const }
		: { originalText: anchorText, replacementText: `${anchorText} — with additional clarity`, status: "pending" as const };

	return thread(docId, anchor, "open", [
		msg("Claude", "agent", "I noticed this section could be clearer. Here's a suggested revision:", 30, { suggestion }),
	], 30);
}

function makeResolvedThread(docId: string, anchor: AnchorCandidate): CommentThread {
	return thread(docId, anchor, "resolved", [
		msg("You", "human", "Is this claim accurate? I want to double-check before publishing.", 120),
		msg("Claude", "agent", "I verified this against the source material. The statement is accurate as written. The key data points match the referenced study.", 118, {
			knowledgeRefs: ["research:arxiv/2024.12345", "docs:internal/fact-check-log"],
		}),
		msg("You", "human", "Great, thanks for checking.", 115),
	], 120);
}

function makeKnowledgeRefThread(docId: string, anchor: AnchorCandidate): CommentThread {
	return thread(docId, anchor, "open", [
		msg("Claude", "agent", "I used several sources to inform this section. Here are the key references for traceability.", 60, {
			knowledgeRefs: [
				"docs:api/authentication",
				"research:arxiv/2401.00001",
				"code:src/utils/helpers.ts:42",
			],
		}),
		msg("You", "human", "Can you summarize the main takeaway from the arxiv paper?", 55),
		msg("Claude", "agent", "The paper proposes a three-layer validation approach that reduces false positives by 40%. The key insight is combining syntactic and semantic checks before the final structural validation pass.", 53),
	], 60);
}

function makeMultiSuggestionThread(docId: string, anchor: AnchorCandidate): CommentThread {
	const firstWord = anchor.anchorText.split(/\s+/)[0] ?? "The";
	return thread(docId, anchor, "open", [
		msg("You", "human", "Can you suggest a few ways to improve this?", 25),
		msg("Claude", "agent", "Here's my first suggestion — a minor rewording for clarity:", 23, {
			suggestion: {
				originalText: firstWord,
				replacementText: `${firstWord} (revised)`,
				status: "rejected" as const,
			},
		}),
		msg("You", "human", "Not quite what I had in mind. Try a different approach.", 20),
		msg("Claude", "agent", "How about this alternative? It preserves the original meaning while being more direct:", 18, {
			suggestion: {
				originalText: anchor.anchorText,
				replacementText: anchor.anchorText.replace(/\.$/, "") + " — stated more directly.",
				status: "pending" as const,
			},
		}),
	], 25);
}

// --- Public API ---

export interface MockSessionResult {
	threadCount: number;
	documentPath: string;
}

/**
 * Generate a mock session with realistic threads on the current document.
 * Writes threads to the sidecar file and returns the result.
 */
export async function createMockSession(
	view: MarkdownView,
	storage: SidecarStorage,
): Promise<MockSessionResult> {
	const file = view.file;
	if (!file) {
		throw new Error("No file open in the editor.");
	}

	const content = view.editor.getValue();
	if (content.trim().length < 20) {
		throw new Error("Document is too short to anchor mock threads. Add some content first.");
	}

	const docId = file.path;

	// Find anchor points in the document
	const anchors = findAnchors(content, 5);
	if (anchors.length === 0) {
		throw new Error("Could not find suitable text to anchor threads. Add more prose content.");
	}

	// Build threads from available anchors
	const generators = [
		makeConversationThread,
		makeSuggestionThread,
		makeResolvedThread,
		makeKnowledgeRefThread,
		makeMultiSuggestionThread,
	];

	const threads: CommentThread[] = [];
	for (let i = 0; i < anchors.length && i < generators.length; i++) {
		threads.push(generators[i]!(docId, anchors[i]!));
	}

	// Write to sidecar
	await storage.saveImmediate(file, threads);

	return {
		threadCount: threads.length,
		documentPath: file.path,
	};
}

/**
 * Remove all mock/test threads from the current document's sidecar file.
 */
export async function clearMockSession(
	file: TFile,
	storage: SidecarStorage,
): Promise<void> {
	await storage.saveImmediate(file, []);
}
