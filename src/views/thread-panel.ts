/**
 * Thread panel — right sidebar view for comment threads.
 *
 * Shows list of all threads for the active document,
 * grouped by status (open first, resolved if setting enabled).
 * Includes filter bar, search, sort, and bulk actions (M8).
 */

import { ItemView, Platform, WorkspaceLeaf } from "obsidian";
import type AgentCommentsPlugin from "../main";
import type { CommentThread } from "../models/thread";
import type { BackendConnectionStatus } from "../models/backend";
import { ThreadDetailView } from "./thread-detail";

export const THREAD_PANEL_VIEW_TYPE = "agent-comments-thread-panel";

type ThreadFilter = "all" | "open" | "resolved" | "orphaned";
type ThreadSort = "newest" | "oldest" | "most-messages";

export class ThreadPanelView extends ItemView {
	plugin: AgentCommentsPlugin;
	private threads: CommentThread[] = [];
	private orphaned: CommentThread[] = [];
	private selectedThreadId: string | null = null;
	private detailView: ThreadDetailView | null = null;
	private connectionStatus: BackendConnectionStatus = "offline";
	private filter: ThreadFilter = "all";
	private sortOrder: ThreadSort = "newest";
	private searchQuery = "";
	private visibleLimit = 50;

	constructor(leaf: WorkspaceLeaf, plugin: AgentCommentsPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return THREAD_PANEL_VIEW_TYPE;
	}

	getDisplayText(): string {
		// eslint-disable-next-line obsidianmd/ui/sentence-case -- plugin name
		return "Agent Comments";
	}

	getIcon(): string {
		return "message-square";
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	async onClose(): Promise<void> {
		this.detailView = null;
	}

	/**
	 * Update the thread list and re-render.
	 */
	setThreads(threads: CommentThread[], orphaned: CommentThread[] = []): void {
		this.threads = threads;
		this.orphaned = orphaned;
		this.visibleLimit = 50;
		this.render();
	}

	/**
	 * Update connection status indicator.
	 */
	setConnectionStatus(status: BackendConnectionStatus): void {
		this.connectionStatus = status;
		this.render();
	}

	/**
	 * Select and open a specific thread.
	 */
	selectThread(threadId: string): void {
		this.selectedThreadId = threadId;
		this.render();
	}

	/**
	 * Focus the message composer for a thread.
	 */
	focusComposer(): void {
		const textarea = this.contentEl.querySelector<HTMLTextAreaElement>(
			".agent-comments-composer-input",
		);
		textarea?.focus();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("agent-comments-thread-panel");
		if (Platform.isMobile) {
			contentEl.addClass("agent-comments-bottom-sheet");
		}

		if (this.selectedThreadId) {
			const thread = this.threads.find((t) => t.id === this.selectedThreadId);
			if (thread) {
				this.renderDetail(thread);
				return;
			}
			// Thread not found — clear selection
			this.selectedThreadId = null;
		}

		this.renderList();
	}

	private renderList(): void {
		const { contentEl } = this;

		// Header
		const header = contentEl.createDiv({ cls: "agent-comments-thread-panel-header" });

		const headerLeft = header.createDiv({ cls: "agent-comments-header-left" });
		const title = headerLeft.createSpan({ cls: "agent-comments-thread-panel-title" });
		title.textContent = "Comments";

		// Connection status
		const statusDot = headerLeft.createSpan({ cls: "agent-comments-status-dot" });
		statusDot.addClass(`agent-comments-status-${this.connectionStatus}`);

		// Bulk actions in header
		const headerRight = header.createDiv({ cls: "agent-comments-header-right" });
		const openCount = this.threads.filter((t) => t.status === "open").length;

		if (openCount > 0) {
			const resolveAllBtn = headerRight.createEl("button", {
				cls: "agent-comments-resolve-all-btn",
			});
			resolveAllBtn.textContent = "Resolve all";
			resolveAllBtn.setAttribute("aria-label", `Resolve all ${openCount} open threads`);
			resolveAllBtn.addEventListener("click", () => {
				this.plugin.confirmResolveAllThreads();
			});
		}

		// Thread counts
		const resolvedCount = this.threads.filter((t) => t.status === "resolved").length;
		const counts = contentEl.createDiv({ cls: "agent-comments-thread-counts" });
		const parts: string[] = [];
		if (openCount > 0) parts.push(`${openCount} open`);
		if (resolvedCount > 0) parts.push(`${resolvedCount} resolved`);
		if (this.orphaned.length > 0) parts.push(`${this.orphaned.length} orphaned`);
		counts.textContent = parts.join(", ") || "No threads";

		// Filter and search bar (M8.3)
		this.renderFilterBar(contentEl);

		// Apply filter, search, and sort
		const filteredThreads = this.getFilteredThreads();

		if (filteredThreads.length === 0 && this.filter !== "orphaned") {
			const empty = contentEl.createDiv({ cls: "agent-comments-empty" });
			empty.textContent = this.searchQuery
				? "No threads match your search."
				: "No threads to show.";
		}

		// Render filtered threads (limited to visibleLimit for performance)
		const visibleThreads = filteredThreads.slice(0, this.visibleLimit);
		for (const thread of visibleThreads) {
			this.renderThreadItem(contentEl, thread);
		}

		// "Show more" button when list is truncated
		if (filteredThreads.length > this.visibleLimit) {
			const remaining = filteredThreads.length - this.visibleLimit;
			const showMoreBtn = contentEl.createEl("button", { cls: "agent-comments-show-more-btn" });
			showMoreBtn.textContent = `Show ${Math.min(remaining, 50)} more (${remaining} remaining)`;
			showMoreBtn.addEventListener("click", () => {
				this.visibleLimit += 50;
				this.render();
			});
		}

		// Orphaned threads section (shown when filter is "all" or "orphaned")
		if ((this.filter === "all" || this.filter === "orphaned") && this.orphaned.length > 0) {
			const orphanedToShow = this.filterBySearch(this.orphaned);
			if (orphanedToShow.length > 0) {
				this.renderOrphanedSection(contentEl, orphanedToShow);
			}
		}
	}

	private renderFilterBar(container: HTMLElement): void {
		const filterBar = container.createDiv({ cls: "agent-comments-filter-bar" });

		// Status filter
		const filterSelect = filterBar.createEl("select", { cls: "agent-comments-filter-select" });
		const options: Array<{ value: ThreadFilter; label: string }> = [
			{ value: "all", label: "All" },
			{ value: "open", label: "Open" },
			{ value: "resolved", label: "Resolved" },
			{ value: "orphaned", label: "Orphaned" },
		];
		for (const opt of options) {
			const el = filterSelect.createEl("option");
			el.value = opt.value;
			el.textContent = opt.label;
			if (opt.value === this.filter) el.selected = true;
		}
		filterSelect.addEventListener("change", () => {
			this.filter = filterSelect.value as ThreadFilter;
			this.render();
		});

		// Sort select
		const sortSelect = filterBar.createEl("select", { cls: "agent-comments-sort-select" });
		const sortOptions: Array<{ value: ThreadSort; label: string }> = [
			{ value: "newest", label: "Newest" },
			{ value: "oldest", label: "Oldest" },
			{ value: "most-messages", label: "Most messages" },
		];
		for (const opt of sortOptions) {
			const el = sortSelect.createEl("option");
			el.value = opt.value;
			el.textContent = opt.label;
			if (opt.value === this.sortOrder) el.selected = true;
		}
		sortSelect.addEventListener("change", () => {
			this.sortOrder = sortSelect.value as ThreadSort;
			this.render();
		});

		// Search input
		const searchInput = filterBar.createEl("input", {
			cls: "agent-comments-search-input",
			type: "text",
			placeholder: "Search threads...",
		});
		searchInput.value = this.searchQuery;
		searchInput.addEventListener("input", () => {
			this.searchQuery = searchInput.value;
			this.render();
		});
	}

	private getFilteredThreads(): CommentThread[] {
		let threads: CommentThread[];

		switch (this.filter) {
			case "open":
				threads = this.threads.filter((t) => t.status === "open");
				break;
			case "resolved":
				threads = this.threads.filter((t) => t.status === "resolved");
				break;
			case "orphaned":
				// Orphaned threads are rendered in a separate section
				return [];
			case "all":
			default: {
				const open = this.threads.filter((t) => t.status === "open");
				const resolved = this.plugin.settings.showResolvedThreads
					? this.threads.filter((t) => t.status === "resolved")
					: [];
				threads = [...open, ...resolved];
				break;
			}
		}

		// Apply search
		threads = this.filterBySearch(threads);

		// Apply sort
		threads = this.sortThreads(threads);

		return threads;
	}

	private filterBySearch<T extends CommentThread>(threads: T[]): T[] {
		if (!this.searchQuery) return threads;

		const query = this.searchQuery.toLowerCase();
		return threads.filter((t) => {
			// Search in anchor text
			if (t.anchor.anchorText.toLowerCase().includes(query)) return true;
			// Search in message content
			return t.messages.some((m) => m.content.toLowerCase().includes(query));
		});
	}

	private sortThreads(threads: CommentThread[]): CommentThread[] {
		const sorted = [...threads];

		switch (this.sortOrder) {
			case "newest":
				sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
				break;
			case "oldest":
				sorted.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
				break;
			case "most-messages":
				sorted.sort((a, b) => b.messages.length - a.messages.length);
				break;
		}

		return sorted;
	}

	private renderOrphanedSection(container: HTMLElement, orphanedThreads: CommentThread[]): void {
		const orphanedSection = container.createDiv({ cls: "agent-comments-orphaned-section" });
		const orphanedHeader = orphanedSection.createDiv({ cls: "agent-comments-orphaned-header" });
		orphanedHeader.textContent = "Orphaned threads";

		for (const thread of orphanedThreads) {
			const item = orphanedSection.createDiv({ cls: "agent-comments-orphaned-item" });
			const anchor = item.createDiv({ cls: "agent-comments-thread-item-anchor" });
			anchor.textContent = `"${thread.anchor.anchorText}"`;

			const meta = item.createDiv({ cls: "agent-comments-thread-item-meta" });
			meta.textContent = `${thread.messages.length} message${thread.messages.length !== 1 ? "s" : ""}`;

			const actions = item.createDiv({ cls: "agent-comments-orphaned-actions" });

			const reattachBtn = actions.createEl("button");
			reattachBtn.textContent = "Re-attach";
			reattachBtn.className = "agent-comments-suggestion-accept";
			reattachBtn.setAttribute("aria-label", "Re-attach thread to selected text");
			reattachBtn.addEventListener("click", () => {
				this.plugin.reattachThread(thread.id);
			});

			const dismissBtn = actions.createEl("button");
			dismissBtn.textContent = "Dismiss";
			dismissBtn.className = "agent-comments-suggestion-reject";
			dismissBtn.addEventListener("click", () => {
				this.plugin.confirmDismissOrphanedThread(thread.id);
			});
		}
	}

	private renderThreadItem(container: HTMLElement, thread: CommentThread): void {
		const item = container.createDiv({ cls: "agent-comments-thread-item" });
		item.setAttribute("tabindex", "0");
		item.setAttribute("role", "button");
		item.setAttribute("aria-label",
			`${thread.status === "open" ? "Open" : "Resolved"} thread: "${thread.anchor.anchorText}", ${thread.messages.length} message${thread.messages.length !== 1 ? "s" : ""}`,
		);

		const anchor = item.createDiv({ cls: "agent-comments-thread-item-anchor" });
		anchor.textContent = `"${thread.anchor.anchorText}"`;

		const meta = item.createDiv({ cls: "agent-comments-thread-item-meta" });

		const badge = meta.createSpan({ cls: "agent-comments-thread-status-badge" });
		badge.addClass(thread.status === "open" ? "agent-comments-badge-open" : "agent-comments-badge-resolved");
		badge.textContent = thread.status;

		const msgCount = meta.createSpan();
		msgCount.textContent = `${thread.messages.length} message${thread.messages.length !== 1 ? "s" : ""}`;

		if (thread.messages.length > 0) {
			const lastMsg = thread.messages[thread.messages.length - 1]!;
			const time = meta.createSpan();
			time.textContent = this.formatTimestamp(lastMsg.timestamp);
		}

		const selectThread = (): void => {
			this.selectedThreadId = thread.id;
			this.render();
		};

		item.addEventListener("click", selectThread);
		item.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				selectThread();
			}
		});
	}

	private renderDetail(thread: CommentThread): void {
		this.detailView = new ThreadDetailView(
			this.contentEl,
			this.plugin,
			thread,
			() => {
				this.selectedThreadId = null;
				this.render();
			},
		);
		this.detailView.render();
	}

	private formatTimestamp(iso: string): string {
		try {
			const date = new Date(iso);
			const now = new Date();
			const diffMs = now.getTime() - date.getTime();
			const diffMins = Math.floor(diffMs / 60000);

			if (diffMins < 1) return "just now";
			if (diffMins < 60) return `${diffMins}m ago`;

			const diffHours = Math.floor(diffMins / 60);
			if (diffHours < 24) return `${diffHours}h ago`;

			const diffDays = Math.floor(diffHours / 24);
			return `${diffDays}d ago`;
		} catch {
			return "";
		}
	}
}
