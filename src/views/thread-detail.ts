/**
 * Thread detail view — renders inside the thread panel
 * when a thread is selected.
 *
 * Shows anchor text, message list, suggestion diffs,
 * and message composer.
 */

import { MarkdownRenderer } from "obsidian";
import type AgentCommentsPlugin from "../main";
import type { CommentThread, ThreadMessage } from "../models/thread";
import { createMessage } from "../models/thread";
import { computeDiff } from "../utils/diff";

export class ThreadDetailView {
	private container: HTMLElement;
	private plugin: AgentCommentsPlugin;
	private thread: CommentThread;
	private onBack: () => void;

	constructor(
		container: HTMLElement,
		plugin: AgentCommentsPlugin,
		thread: CommentThread,
		onBack: () => void,
	) {
		this.container = container;
		this.plugin = plugin;
		this.thread = thread;
		this.onBack = onBack;
	}

	render(): void {
		const { container, thread } = this;
		container.empty();
		container.addClass("agent-comments-thread-detail");

		// Header with back button
		const header = container.createDiv({ cls: "agent-comments-thread-detail-header" });

		const backBtn = header.createEl("button", { cls: "agent-comments-back-button" });
		backBtn.textContent = "\u2190";
		backBtn.setAttribute("aria-label", "Back to thread list");
		backBtn.addEventListener("click", this.onBack);

		const title = header.createSpan();
		title.textContent = thread.status === "open" ? "Open thread" : "Resolved thread";

		// Anchor text quote
		const quote = container.createDiv({ cls: "agent-comments-anchor-quote" });
		quote.textContent = thread.anchor.anchorText;

		// Messages
		for (const message of thread.messages) {
			this.renderMessage(container, message);
		}

		// Thread actions
		const actions = container.createDiv({ cls: "agent-comments-bulk-actions" });

		if (thread.status === "open") {
			const resolveBtn = actions.createEl("button", { cls: "agent-comments-suggestion-accept" });
			resolveBtn.textContent = "Resolve";
			resolveBtn.addEventListener("click", () => {
				void this.plugin.resolveThread(thread.id);
			});
		} else {
			const reopenBtn = actions.createEl("button", { cls: "agent-comments-suggestion-reject" });
			reopenBtn.textContent = "Reopen";
			reopenBtn.addEventListener("click", () => {
				void this.plugin.reopenThread(thread.id);
			});
		}

		// Message composer — never disabled, works offline
		this.renderComposer(container);
	}

	private renderMessage(container: HTMLElement, message: ThreadMessage): void {
		const msgEl = container.createDiv({ cls: "agent-comments-message" });

		// Header: author badge + timestamp
		const header = msgEl.createDiv({ cls: "agent-comments-message-header" });

		const badge = header.createSpan({ cls: "agent-comments-author-badge" });
		badge.addClass(
			message.authorType === "human"
				? "agent-comments-author-human"
				: "agent-comments-author-agent",
		);
		badge.textContent = message.author;

		const time = header.createSpan();
		time.textContent = this.formatTime(message.timestamp);

		// Content — rendered as markdown via Obsidian's renderer
		const content = msgEl.createDiv({ cls: "agent-comments-message-content" });
		// Use MarkdownRenderer for safe markdown rendering
		// eslint-disable-next-line obsidianmd/no-plugin-as-component -- MarkdownRenderer requires a Component
		void MarkdownRenderer.render(this.plugin.app, message.content, content, "", this.plugin);

		// Suggestion diff
		if (message.suggestion) {
			const { suggestion } = message;

			if (suggestion.status === "pending") {
				const diffEl = msgEl.createDiv({ cls: "agent-comments-suggestion" });

				// Inline diff view (desktop)
				const inlineDiff = diffEl.createDiv({ cls: "agent-comments-suggestion-diff" });
				const segments = computeDiff(suggestion.originalText, suggestion.replacementText);

				for (const segment of segments) {
					const span = inlineDiff.createSpan();
					span.textContent = segment.text;

					switch (segment.type) {
						case "delete":
							span.addClass("agent-comments-diff-delete");
							break;
						case "insert":
							span.addClass("agent-comments-diff-insert");
							break;
						case "equal":
							span.addClass("agent-comments-diff-equal");
							break;
					}
				}

				// Card view (mobile) — "Original" and "Suggested" blocks
				const originalCard = diffEl.createDiv({ cls: "agent-comments-suggestion-card agent-comments-suggestion-card-original" });
				originalCard.createDiv({ cls: "agent-comments-suggestion-card-label", text: "Original" });
				originalCard.createDiv({ text: suggestion.originalText });

				const suggestedCard = diffEl.createDiv({ cls: "agent-comments-suggestion-card agent-comments-suggestion-card-suggested" });
				suggestedCard.createDiv({ cls: "agent-comments-suggestion-card-label", text: "Suggested" });
				suggestedCard.createDiv({ text: suggestion.replacementText });

				const btnContainer = diffEl.createDiv({ cls: "agent-comments-bulk-actions" });

				const acceptBtn = btnContainer.createEl("button", { cls: "agent-comments-suggestion-accept" });
				acceptBtn.textContent = "Accept";
				acceptBtn.setAttribute("aria-label", "Accept suggestion");
				acceptBtn.addEventListener("click", () => {
					void this.plugin.acceptSuggestion(this.thread.id, message.id);
				});

				const rejectBtn = btnContainer.createEl("button", { cls: "agent-comments-suggestion-reject" });
				rejectBtn.textContent = "Reject";
				rejectBtn.setAttribute("aria-label", "Reject suggestion");
				rejectBtn.addEventListener("click", () => {
					void this.plugin.rejectSuggestion(this.thread.id, message.id);
				});
			} else {
				const statusEl = msgEl.createDiv({ cls: "agent-comments-thread-counts" });
				statusEl.textContent = `Suggestion ${suggestion.status}`;
			}
		}

		// Knowledge refs — rendered via registered providers or as plain badges
		if (message.knowledgeRefs && message.knowledgeRefs.length > 0) {
			const refsEl = msgEl.createDiv({ cls: "agent-comments-knowledge-refs" });
			for (const ref of message.knowledgeRefs) {
				const rendered = this.plugin.renderKnowledgeRef(ref);
				if (rendered) {
					refsEl.appendChild(rendered);
				} else {
					// Default: plain text badge
					const refBadge = refsEl.createSpan({ cls: "agent-comments-knowledge-ref" });
					refBadge.textContent = ref;
				}
			}
		}
	}

	private renderComposer(container: HTMLElement): void {
		const composer = container.createDiv({ cls: "agent-comments-composer" });

		const textarea = composer.createEl("textarea", { cls: "agent-comments-composer-input" });
		textarea.placeholder = "Type a message...";

		const sendBtn = composer.createEl("button", { cls: "agent-comments-composer-send" });
		sendBtn.textContent = "Send";

		const sendMessage = async (): Promise<void> => {
			const content = textarea.value.trim();
			if (!content) return;

			const message = createMessage({
				author: this.plugin.settings.defaultAuthorName,
				authorType: "human",
				content,
			});

			await this.plugin.addMessage(this.thread.id, message);
			textarea.value = "";
			this.render();
		};

		sendBtn.addEventListener("click", () => {
			void sendMessage();
		});

		// Enter to send, Shift+Enter for newline
		textarea.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				void sendMessage();
			}
		});
	}

	private formatTime(iso: string): string {
		try {
			const date = new Date(iso);
			return date.toLocaleTimeString(undefined, {
				hour: "2-digit",
				minute: "2-digit",
			});
		} catch {
			return "";
		}
	}
}
