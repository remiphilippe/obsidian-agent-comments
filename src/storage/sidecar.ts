/**
 * Sidecar file storage — reads/writes .agent-comments.json files.
 *
 * Per-document sidecar files keep markdown clean. Other tools
 * see plain markdown. The plugin renders threads as CM6 decorations.
 */

import { Notice, TFile, Vault } from "obsidian";
import type { CommentThread, SidecarFile } from "../models/thread";
import { validateSidecarFile } from "../models/thread";

const SIDECAR_EXTENSION = ".agent-comments.json";
const SCHEMA_VERSION = 1;
const SAVE_DEBOUNCE_MS = 500;

export class SidecarStorage {
	private vault: Vault;
	private saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

	constructor(vault: Vault) {
		this.vault = vault;
	}

	/**
	 * Returns the sidecar file path for a document.
	 * Only processes .md files — rejects other file types.
	 */
	getPath(documentFile: TFile): string {
		if (documentFile.extension !== "md") {
			throw new Error(`Only .md files are supported, got: ${documentFile.path}`);
		}

		// Replace .md extension with sidecar extension
		const basePath = documentFile.path.slice(0, -3); // remove ".md"
		return basePath + SIDECAR_EXTENSION;
	}

	/**
	 * Loads threads from the sidecar file for a document.
	 * Returns empty array if file doesn't exist or is malformed.
	 */
	async load(documentFile: TFile): Promise<CommentThread[]> {
		const path = this.getPath(documentFile);

		try {
			const sidecarFile = this.vault.getAbstractFileByPath(path);
			if (!sidecarFile || !(sidecarFile instanceof TFile)) {
				return [];
			}

			const content = await this.vault.read(sidecarFile);
			const data: unknown = JSON.parse(content);

			const validation = validateSidecarFile(data);
			if (!validation.valid) {
				console.warn(`[agent-comments] Invalid sidecar file ${path}: ${validation.error}`);
				new Notice(`Agent Comments: Invalid comment data in ${path}`);
				return [];
			}

			return (data as SidecarFile).threads;
		} catch (err) {
			if (err instanceof SyntaxError) {
				console.warn(`[agent-comments] Malformed JSON in ${path}: ${err.message}`);
				new Notice(`Agent Comments: Malformed comment data in ${path}`);
				return [];
			}
			// File doesn't exist — normal for first use
			return [];
		}
	}

	/**
	 * Saves threads to the sidecar file.
	 * Writes are debounced to avoid excessive I/O during rapid edits.
	 */
	async save(documentFile: TFile, threads: CommentThread[]): Promise<void> {
		const path = this.getPath(documentFile);

		// Cancel any pending debounced save for this path
		const existingTimer = this.saveTimers.get(path);
		if (existingTimer) {
			clearTimeout(existingTimer);
		}

		return new Promise<void>((resolve) => {
			const timer = setTimeout(() => {
				this.saveTimers.delete(path);
				void this.writeFile(path, documentFile.path, threads).then(resolve);
			}, SAVE_DEBOUNCE_MS);

			this.saveTimers.set(path, timer);
		});
	}

	/**
	 * Saves threads immediately, bypassing debounce.
	 * Use for critical operations like suggestion acceptance.
	 */
	async saveImmediate(documentFile: TFile, threads: CommentThread[]): Promise<void> {
		const path = this.getPath(documentFile);

		// Cancel any pending debounced save
		const existingTimer = this.saveTimers.get(path);
		if (existingTimer) {
			clearTimeout(existingTimer);
			this.saveTimers.delete(path);
		}

		await this.writeFile(path, documentFile.path, threads);
	}

	/**
	 * Checks if a sidecar file exists for the document.
	 */
	async exists(documentFile: TFile): Promise<boolean> {
		const path = this.getPath(documentFile);
		const file = this.vault.getAbstractFileByPath(path);
		return file !== null;
	}

	/**
	 * Deletes the sidecar file for a document.
	 */
	async delete(documentFile: TFile): Promise<void> {
		const path = this.getPath(documentFile);
		const file = this.vault.getAbstractFileByPath(path);
		if (file && file instanceof TFile) {
			// Sidecar files are internal data, not user documents — direct delete is appropriate
			// eslint-disable-next-line obsidianmd/prefer-file-manager-trash-file
			await this.vault.delete(file);
		}
	}

	/**
	 * Cancels all pending debounced saves.
	 * Call in plugin onunload().
	 */
	destroy(): void {
		for (const timer of this.saveTimers.values()) {
			clearTimeout(timer);
		}
		this.saveTimers.clear();
	}

	private async writeFile(
		path: string,
		documentPath: string,
		threads: CommentThread[],
	): Promise<void> {
		const sidecar: SidecarFile = {
			version: SCHEMA_VERSION,
			documentId: documentPath,
			threads,
		};

		const content = JSON.stringify(sidecar, null, "\t");
		const existing = this.vault.getAbstractFileByPath(path);

		if (existing && existing instanceof TFile) {
			await this.vault.modify(existing, content);
		} else {
			await this.vault.create(path, content);
		}
	}
}
