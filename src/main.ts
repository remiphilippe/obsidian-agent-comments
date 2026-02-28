import { type App, MarkdownView, Menu, Modal, Notice, Plugin, TFile } from "obsidian";
import {
	type AgentCommentsSettings,
	DEFAULT_SETTINGS,
	AgentCommentsSettingTab,
} from "./settings";
import { SidecarStorage } from "./storage/sidecar";
import { createBackend } from "./backend/factory";
import { updateAnchors, extractSectionHeading } from "./storage/anchor";
import type { ThreadMessage } from "./models/thread";
import type { AgentCommentsBackend } from "./models/backend";
import {
	ThreadPanelView,
	THREAD_PANEL_VIEW_TYPE,
} from "./views/thread-panel";
import { threadStateField, setThreadsEffect, showResolvedField, setShowResolvedEffect } from "./editor/state";
import { threadGutter, anchorHighlightPlugin } from "./editor/decorations";

export type KnowledgeRefRenderer = (ref: string) => HTMLElement | null;

export default class AgentCommentsPlugin extends Plugin {
	settings: AgentCommentsSettings = DEFAULT_SETTINGS;
	private storage!: SidecarStorage;
	private backend!: AgentCommentsBackend & { setActiveDocument?(file: TFile): Promise<void>; getThreads?(): import("./models/thread").CommentThread[] };
	private threadPanel: ThreadPanelView | null = null;
	private reanchorTimer: ReturnType<typeof setTimeout> | null = null;
	private previousOrphanedIds = new Set<string>();
	private knowledgeRefProviders = new Map<string, KnowledgeRefRenderer>();

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new AgentCommentsSettingTab(this.app, this));

		// Initialize storage
		this.storage = new SidecarStorage(this.app.vault);

		// Initialize backend based on settings
		this.backend = createBackend(this.settings, this.app.vault, this.storage);

		// Register the thread panel view
		this.registerView(THREAD_PANEL_VIEW_TYPE, (leaf) => {
			const panel = new ThreadPanelView(leaf, this);
			this.threadPanel = panel;
			return panel;
		});

		// Ribbon icon to toggle thread panel
		// eslint-disable-next-line obsidianmd/ui/sentence-case -- plugin name
		this.addRibbonIcon("message-square", "Agent Comments", () => {
			void this.toggleThreadPanel();
		});

		// Defer initialization until the editor is ready.
		// This prevents the fresh-install crash that plagued CriticMarkup (#16, #18)
		// where StateFields were accessed before the editor was ready.
		this.app.workspace.onLayoutReady(() => {
			this.initializePlugin();
		});
	}

	private initializePlugin(): void {
		// Register CM6 editor extensions
		this.registerEditorExtension([
			threadStateField,
			showResolvedField,
			threadGutter,
			anchorHighlightPlugin,
		]);

		// Initialize showResolved state from settings
		this.updateShowResolved(this.settings.showResolvedThreads);

		// Command: New comment thread from selection
		this.addCommand({
			id: "new-thread",
			name: "New comment thread",
			editorCallback: (editor) => {
				const selection = editor.getSelection();
				if (!selection) {
					new Notice("Select text to create a comment thread.");
					return;
				}

				const from = editor.getCursor("from");
				const to = editor.getCursor("to");
				const startOffset = editor.posToOffset(from);
				const endOffset = editor.posToOffset(to);
				const docContent = editor.getValue();
				const sectionHeading = extractSectionHeading(docContent, startOffset);

				void this.createThread({
					anchorText: selection,
					startOffset,
					endOffset,
					sectionHeading,
				});
			},
		});

		// Command: Toggle thread panel
		this.addCommand({
			id: "toggle-panel",
			name: "Toggle comment panel",
			callback: () => {
				void this.toggleThreadPanel();
			},
		});

		// Command: Regenerate section (M8.1)
		this.addCommand({
			id: "regenerate-section",
			name: "Regenerate section",
			editorCallback: (editor) => {
				// Only available when backend is connected (not local/offline)
				if (this.backend.connectionStatus !== "connected") {
					new Notice("Section regeneration requires a connected backend.");
					return;
				}

				const cursor = editor.getCursor();
				const docContent = editor.getValue();
				const cursorOffset = editor.posToOffset(cursor);

				// Find the heading at or above the cursor
				const heading = extractSectionHeading(docContent, cursorOffset);
				if (!heading) {
					new Notice("Place your cursor in or below a heading to regenerate a section.");
					return;
				}

				// Extract section content (from heading to next heading of same or higher level)
				const section = this.extractSection(docContent, cursorOffset);
				if (!section) {
					new Notice("Could not extract section content.");
					return;
				}

				void this.createThread({
					anchorText: section.text,
					startOffset: section.startOffset,
					endOffset: section.endOffset,
					sectionHeading: heading,
				});
			},
		});

		// Context menu: Regenerate section (Fix 1)
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu: Menu, editor) => {
				if (this.backend.connectionStatus !== "connected") return;

				const cursor = editor.getCursor();
				const docContent = editor.getValue();
				const cursorOffset = editor.posToOffset(cursor);
				const heading = extractSectionHeading(docContent, cursorOffset);

				if (!heading) return;

				menu.addItem((item) => {
					item.setTitle("Regenerate section")
						.setIcon("refresh-cw")
						.onClick(() => {
							const section = this.extractSection(docContent, cursorOffset);
							if (!section) {
								new Notice("Could not extract section content.");
								return;
							}

							void this.createThread({
								anchorText: section.text,
								startOffset: section.startOffset,
								endOffset: section.endOffset,
								sectionHeading: heading,
							});
						});
				});
			}),
		);

		// Reading mode support (M8.4) — margin badges for threads
		this.registerMarkdownPostProcessor((el, ctx) => {
			this.addReadingModeIndicators(el, ctx.sourcePath);
		});

		// Listen to active file changes
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (file && file instanceof TFile && file.extension === "md") {
					void this.onFileOpen(file);
				}
			}),
		);

		// Listen to editor changes for automatic re-anchoring (M6)
		this.registerEvent(
			this.app.workspace.on("editor-change", () => {
				this.scheduleReanchor();
			}),
		);

		// Load threads for current file
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile && activeFile.extension === "md") {
			void this.onFileOpen(activeFile);
		}
	}

	private async onFileOpen(file: TFile): Promise<void> {
		if (this.backend.setActiveDocument) {
			await this.backend.setActiveDocument(file);
		}
		this.refreshPanel();
	}

	private refreshPanel(): void {
		if (this.backend.getThreads) {
			const threads = this.backend.getThreads();
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);

			if (view) {
				const content = view.editor.getValue();
				const result = updateAnchors([...threads], content, content);

				// Update sidebar panel
				this.threadPanel?.setThreads(result.updated, result.orphaned);

				// Update CM6 editor state (gutter dots, anchor highlights)
				// Access the underlying CM6 EditorView — Obsidian doesn't expose it directly
				// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access -- Obsidian internal API
				const cmEditor = (view.editor as any).cm as import("@codemirror/view").EditorView | undefined;
				if (cmEditor) {
					cmEditor.dispatch({
						effects: setThreadsEffect.of(result.updated),
					});
				}
			} else {
				this.threadPanel?.setThreads(threads);
			}
		}

		this.threadPanel?.setConnectionStatus(this.backend.connectionStatus);
	}

	// --- Re-anchoring on document change (M6) ---

	private scheduleReanchor(): void {
		if (this.reanchorTimer !== null) {
			clearTimeout(this.reanchorTimer);
		}
		this.reanchorTimer = setTimeout(() => {
			this.reanchorTimer = null;
			this.reanchorThreads();
		}, 200);
	}

	private reanchorThreads(): void {
		if (!this.backend.getThreads) return;
		const threads = this.backend.getThreads();
		if (threads.length === 0) {
			this.previousOrphanedIds.clear();
			return;
		}

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;

		const content = view.editor.getValue();
		const result = updateAnchors([...threads], content, content);

		// Detect newly orphaned threads and notify user
		const currentOrphanedIds = new Set(result.orphaned.map((t) => t.id));
		const newlyOrphaned = result.orphaned.filter(
			(t) => !this.previousOrphanedIds.has(t.id),
		);
		this.previousOrphanedIds = currentOrphanedIds;

		if (newlyOrphaned.length > 0 && this.settings.showOrphanedNotice) {
			new Notice(
				`${newlyOrphaned.length} comment thread${newlyOrphaned.length === 1 ? "" : "s"} became orphaned.`,
			);
		}

		// Update sidebar panel
		this.threadPanel?.setThreads(result.updated, result.orphaned);

		// Update CM6 editor state (gutter dots, anchor highlights)
		// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access -- Obsidian internal API
		const cmEditor = (view.editor as any).cm as import("@codemirror/view").EditorView | undefined;
		if (cmEditor) {
			cmEditor.dispatch({
				effects: setThreadsEffect.of(result.updated),
			});
		}

		// Save to sidecar (debounced — storage.save() has its own 500ms debounce)
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile) {
			void this.storage.save(activeFile, threads);
		}
	}

	// --- Public API for thread operations (called by views) ---

	async createThread(anchor: import("./models/thread").TextAnchor): Promise<void> {
		const thread = await this.backend.createThread(anchor);

		// Immediate visual feedback (CriticMarkup #35, #43)
		this.refreshPanel();

		// Open panel and select the new thread
		await this.ensurePanelOpen();
		this.threadPanel?.selectThread(thread.id);

		// Focus the composer for immediate input
		setTimeout(() => {
			this.threadPanel?.focusComposer();
		}, 50);
	}

	async addMessage(threadId: string, message: ThreadMessage): Promise<void> {
		await this.backend.addMessage(threadId, message);
		this.refreshPanel();
	}

	async resolveThread(threadId: string): Promise<void> {
		await this.backend.resolveThread(threadId);
		this.refreshPanel();
	}

	async reopenThread(threadId: string): Promise<void> {
		await this.backend.reopenThread(threadId);
		this.refreshPanel();
	}

	async acceptSuggestion(threadId: string, messageId: string): Promise<void> {
		try {
			await this.backend.acceptSuggestion(threadId, messageId);
			new Notice("Suggestion accepted.");
		} catch (err) {
			new Notice(`Failed to accept suggestion: ${err instanceof Error ? err.message : "Unknown error"}`);
		}
		this.refreshPanel();
	}

	async rejectSuggestion(threadId: string, messageId: string): Promise<void> {
		await this.backend.rejectSuggestion(threadId, messageId);
		this.refreshPanel();
	}

	dismissOrphanedThread(threadId: string): void {
		// Remove from backend's thread list
		if (this.backend.getThreads) {
			const threads = this.backend.getThreads();
			const idx = threads.findIndex((t) => t.id === threadId);
			if (idx >= 0) {
				threads.splice(idx, 1);
				this.previousOrphanedIds.delete(threadId);
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile) {
					void this.storage.saveImmediate(activeFile, threads);
				}
			}
		}
		this.refreshPanel();
	}

	confirmDismissOrphanedThread(threadId: string): void {
		new DismissConfirmModal(this.app, () => {
			this.dismissOrphanedThread(threadId);
		}).open();
	}

	reattachThread(threadId: string): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			new Notice("Open a markdown file to re-attach this thread."); // eslint-disable-line obsidianmd/ui/sentence-case -- button label reference
			return;
		}

		const editor = view.editor;
		const selection = editor.getSelection();
		if (!selection) {
			new Notice("Select text in the editor first, then click Re-attach."); // eslint-disable-line obsidianmd/ui/sentence-case -- button label reference
			return;
		}

		if (!this.backend.getThreads) return;
		const threads = this.backend.getThreads();
		const thread = threads.find((t) => t.id === threadId);
		if (!thread) return;

		const from = editor.getCursor("from");
		const to = editor.getCursor("to");
		const docContent = editor.getValue();

		thread.anchor = {
			anchorText: selection,
			startOffset: editor.posToOffset(from),
			endOffset: editor.posToOffset(to),
			sectionHeading: extractSectionHeading(docContent, editor.posToOffset(from)),
		};

		this.previousOrphanedIds.delete(threadId);

		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile) {
			void this.storage.saveImmediate(activeFile, threads);
		}
		this.refreshPanel();
		new Notice("Thread re-attached.");
	}

	// --- Bulk operations (M8.2) ---

	confirmResolveAllThreads(): void {
		if (!this.backend.getThreads) return;
		const openThreads = this.backend.getThreads().filter((t) => t.status === "open");
		if (openThreads.length === 0) {
			new Notice("No open threads to resolve.");
			return;
		}

		new ResolveAllModal(this.app, openThreads.length, () => {
			void this.resolveAllThreads();
		}).open();
	}

	private async resolveAllThreads(): Promise<void> {
		if (!this.backend.getThreads) return;
		const openThreads = this.backend.getThreads().filter((t) => t.status === "open");

		for (const thread of openThreads) {
			await this.backend.resolveThread(thread.id);
		}

		new Notice(`Resolved ${openThreads.length} thread${openThreads.length === 1 ? "" : "s"}.`);
		this.refreshPanel();
	}

	// --- Section extraction (M8.1) ---

	private extractSection(content: string, offset: number): { text: string; startOffset: number; endOffset: number } | null {
		const lines = content.split("\n");
		let currentOffset = 0;
		let sectionStartLine = -1;
		let sectionLevel = 0;

		// Find the heading at or above the offset
		for (let i = 0; i < lines.length; i++) {
			const lineEnd = currentOffset + lines[i]!.length;
			const match = /^(#{1,6})\s/.exec(lines[i]!);

			if (match && currentOffset <= offset) {
				sectionStartLine = i;
				sectionLevel = match[1]!.length;
			}

			if (lineEnd >= offset && sectionStartLine >= 0) break;
			currentOffset = lineEnd + 1; // +1 for newline
		}

		if (sectionStartLine === -1) return null;

		// Find section start offset
		let startOffset = 0;
		for (let i = 0; i < sectionStartLine; i++) {
			startOffset += lines[i]!.length + 1;
		}

		// Find section end — next heading of same or higher level, or end of document
		let endLine = lines.length;
		for (let i = sectionStartLine + 1; i < lines.length; i++) {
			const match = /^(#{1,6})\s/.exec(lines[i]!);
			if (match && match[1]!.length <= sectionLevel) {
				endLine = i;
				break;
			}
		}

		let endOffset = 0;
		for (let i = 0; i < endLine; i++) {
			endOffset += lines[i]!.length + 1;
		}
		// Remove trailing newline
		if (endOffset > 0) endOffset--;

		const text = content.slice(startOffset, endOffset);
		return { text, startOffset, endOffset };
	}

	// --- Reading mode indicators (M8.4) ---

	private addReadingModeIndicators(el: HTMLElement, sourcePath: string): void {
		if (!this.backend.getThreads) return;
		const threads = this.backend.getThreads();
		if (threads.length === 0) return;

		// Only process if this is for the active document
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile || activeFile.path !== sourcePath) return;

		// Find paragraph elements and check if they contain thread anchor text
		const paragraphs = Array.from(el.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, blockquote"));
		for (const p of paragraphs) {
			const text = p.textContent ?? "";
			if (!text) continue;

			const matchingThreads = threads.filter((t) =>
				text.includes(t.anchor.anchorText),
			);

			if (matchingThreads.length > 0) {
				const badge = document.createElement("span");
				badge.className = "agent-comments-reading-badge";
				badge.textContent = `${matchingThreads.length}`;
				badge.setAttribute("aria-label", `${matchingThreads.length} comment thread${matchingThreads.length === 1 ? "" : "s"}`);
				badge.addEventListener("click", (e) => {
					e.stopPropagation();
					void this.ensurePanelOpen();
					this.threadPanel?.selectThread(matchingThreads[0]!.id);
				});
				(p as HTMLElement).addClass("agent-comments-reading-anchor");
				p.appendChild(badge);
			}
		}
	}

	// --- knowledgeRefs extension point (M8.5) ---

	/**
	 * Public API: Register a knowledge ref renderer for a given prefix.
	 * External plugins call this to render recognized knowledge refs
	 * as interactive elements instead of plain text badges.
	 *
	 * Example:
	 *   app.plugins.plugins['agent-comments'].registerKnowledgeRefProvider(
	 *     'research:',
	 *     (ref) => { ... return HTMLElement }
	 *   );
	 */
	registerKnowledgeRefProvider(prefix: string, renderer: KnowledgeRefRenderer): void {
		this.knowledgeRefProviders.set(prefix, renderer);
	}

	/**
	 * Render a knowledge ref using registered providers.
	 * Returns null if no provider matches (caller renders default badge).
	 */
	renderKnowledgeRef(ref: string): HTMLElement | null {
		for (const [prefix, renderer] of this.knowledgeRefProviders) {
			if (ref.startsWith(prefix)) {
				return renderer(ref);
			}
		}
		return null;
	}

	private async toggleThreadPanel(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(THREAD_PANEL_VIEW_TYPE);
		if (existing.length > 0) {
			existing[0]!.detach();
			return;
		}
		await this.ensurePanelOpen();
	}

	private async ensurePanelOpen(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(THREAD_PANEL_VIEW_TYPE);
		if (existing.length > 0) {
			void this.app.workspace.revealLeaf(existing[0]!);
			return;
		}

		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({
				type: THREAD_PANEL_VIEW_TYPE,
				active: true,
			});
			void this.app.workspace.revealLeaf(leaf);
		}
	}

	/**
	 * Recreate the backend after settings change.
	 * Called from settings tab when backend type or URL changes.
	 */
	recreateBackend(): void {
		// Disconnect existing backend
		this.backend.disconnect?.();

		// Clear outbox if it's an offline-aware backend
		const offlineBackend = this.backend as { clearOutbox?(): void };
		offlineBackend.clearOutbox?.();

		// Create new backend from current settings
		this.backend = createBackend(this.settings, this.app.vault, this.storage);

		// Connect if it's a network backend
		if (this.backend.connect) {
			void this.backend.connect();
		}

		// Reload threads for active file
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile && activeFile.extension === "md") {
			void this.onFileOpen(activeFile);
		}
	}

	/**
	 * Update showResolvedThreads visibility in all editor views.
	 * Called from settings tab when the toggle changes.
	 */
	updateShowResolved(show: boolean): void {
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView) {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access -- Obsidian internal API
				const cmEditor = (leaf.view.editor as any).cm as import("@codemirror/view").EditorView | undefined;
				cmEditor?.dispatch({
					effects: setShowResolvedEffect.of(show),
				});
			}
		});
	}

	onunload(): void {
		if (this.reanchorTimer !== null) {
			clearTimeout(this.reanchorTimer);
			this.reanchorTimer = null;
		}

		// Disconnect backend and clear outbox
		this.backend?.disconnect?.();
		const offlineBackend = this.backend as { clearOutbox?(): void } | undefined;
		offlineBackend?.clearOutbox?.();

		this.storage?.destroy();
		this.threadPanel = null;
	}

	async loadSettings(): Promise<void> {
		const data = await this.loadData() as Partial<AgentCommentsSettings> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...data };
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

/**
 * Confirmation modal for resolving all open threads (M8.2).
 */
class ResolveAllModal extends Modal {
	private count: number;
	private onConfirm: () => void;

	constructor(app: App, count: number, onConfirm: () => void) {
		super(app);
		this.count = count;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: "Resolve all threads" });
		contentEl.createEl("p", {
			text: `This will resolve ${this.count} open thread${this.count === 1 ? "" : "s"}. You can reopen them later.`,
		});

		const actions = contentEl.createDiv({ cls: "agent-comments-bulk-actions" });

		const confirmBtn = actions.createEl("button", { cls: "agent-comments-suggestion-accept" });
		confirmBtn.textContent = "Resolve all";
		confirmBtn.addEventListener("click", () => {
			this.onConfirm();
			this.close();
		});

		const cancelBtn = actions.createEl("button");
		cancelBtn.textContent = "Cancel";
		cancelBtn.addEventListener("click", () => {
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * Confirmation modal for dismissing orphaned threads.
 * Uses Obsidian's Modal (not alert/confirm) per CLAUDE.md conventions.
 */
class DismissConfirmModal extends Modal {
	private onConfirm: () => void;

	constructor(app: App, onConfirm: () => void) {
		super(app);
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: "Dismiss orphaned thread" });
		contentEl.createEl("p", {
			text: "This will permanently delete this orphaned thread and all its messages. This action cannot be undone.",
		});

		const actions = contentEl.createDiv({ cls: "agent-comments-bulk-actions" });

		const confirmBtn = actions.createEl("button", { cls: "agent-comments-suggestion-reject" });
		confirmBtn.textContent = "Dismiss";
		confirmBtn.addEventListener("click", () => {
			this.onConfirm();
			this.close();
		});

		const cancelBtn = actions.createEl("button");
		cancelBtn.textContent = "Cancel";
		cancelBtn.addEventListener("click", () => {
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
