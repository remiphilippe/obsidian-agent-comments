/**
 * CM6 widget for rendering inline suggestion diffs.
 *
 * Shows deletions (red strikethrough) and insertions (green highlight)
 * with accept/reject buttons.
 *
 * Overrides `eq()` to prevent unnecessary DOM destruction —
 * CriticMarkup's widgets are recreated on every selection change.
 */

import { WidgetType } from "@codemirror/view";
import { computeDiff } from "../utils/diff";

export interface SuggestionWidgetConfig {
	threadId: string;
	messageId: string;
	originalText: string;
	replacementText: string;
	onAccept: (threadId: string, messageId: string) => void;
	onReject: (threadId: string, messageId: string) => void;
}

export class SuggestionWidget extends WidgetType {
	private config: SuggestionWidgetConfig;

	constructor(config: SuggestionWidgetConfig) {
		super();
		this.config = config;
	}

	toDOM(): HTMLElement {
		const container = document.createElement("span");
		container.className = "agent-comments-suggestion";

		// Compute diff
		const segments = computeDiff(
			this.config.originalText,
			this.config.replacementText,
		);

		// Render diff segments
		const diffContainer = document.createElement("span");
		diffContainer.className = "agent-comments-suggestion-diff";

		for (const segment of segments) {
			const span = document.createElement("span");
			span.textContent = segment.text;

			switch (segment.type) {
				case "delete":
					span.className = "agent-comments-diff-delete";
					break;
				case "insert":
					span.className = "agent-comments-diff-insert";
					break;
				case "equal":
					span.className = "agent-comments-diff-equal";
					break;
			}

			diffContainer.appendChild(span);
		}

		container.appendChild(diffContainer);

		// Accept button
		const acceptBtn = document.createElement("button");
		acceptBtn.className = "agent-comments-suggestion-accept";
		acceptBtn.textContent = "Accept";
		acceptBtn.setAttribute("aria-label", "Accept suggestion");
		acceptBtn.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.config.onAccept(this.config.threadId, this.config.messageId);
		});

		// Reject button
		const rejectBtn = document.createElement("button");
		rejectBtn.className = "agent-comments-suggestion-reject";
		rejectBtn.textContent = "Reject";
		rejectBtn.setAttribute("aria-label", "Reject suggestion");
		rejectBtn.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.config.onReject(this.config.threadId, this.config.messageId);
		});

		container.appendChild(acceptBtn);
		container.appendChild(rejectBtn);

		return container;
	}

	/**
	 * Override eq() to prevent unnecessary DOM destruction.
	 * Only recreate when the underlying thread/suggestion data changes.
	 */
	override eq(other: WidgetType): boolean {
		if (!(other instanceof SuggestionWidget)) return false;
		return (
			this.config.threadId === other.config.threadId &&
			this.config.messageId === other.config.messageId &&
			this.config.originalText === other.config.originalText &&
			this.config.replacementText === other.config.replacementText
		);
	}

	override get estimatedHeight(): number {
		return 24;
	}
}
