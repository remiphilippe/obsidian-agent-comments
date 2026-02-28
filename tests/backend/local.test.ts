import { describe, it, expect, beforeEach, vi } from "vitest";
import { TFile, Vault } from "obsidian";
import { LocalBackend } from "../../src/backend/local";
import { SidecarStorage } from "../../src/storage/sidecar";
import { createMessage, createSuggestion } from "../../src/models/thread";
import type { TextAnchor, ThreadMessage } from "../../src/models/thread";

function makeTFile(path: string): TFile {
	const parts = path.split("/");
	const name = parts.pop()!;
	const dotIdx = name.lastIndexOf(".");
	const basename = dotIdx > 0 ? name.slice(0, dotIdx) : name;
	const extension = dotIdx > 0 ? name.slice(dotIdx + 1) : "";
	return new TFile(path, basename, extension);
}

describe("LocalBackend", () => {
	let vault: Vault;
	let storage: SidecarStorage;
	let backend: LocalBackend;
	let docFile: TFile;

	const docContent = "Hello, this is a test document with some text.";
	const testAnchor: TextAnchor = {
		anchorText: "test document",
		startOffset: 17,
		endOffset: 30,
		sectionHeading: undefined,
	};

	beforeEach(async () => {
		vault = new Vault();
		storage = new SidecarStorage(vault);
		backend = new LocalBackend(storage, vault);
		docFile = makeTFile("test.md");

		// Set up the document in vault
		await vault.create("test.md", docContent);

		await backend.setActiveDocument(docFile);
	});

	describe("createThread", () => {
		it("creates a thread with correct ID, anchor, first message, and status 'open'", async () => {
			const msg = createMessage({
				author: "remi",
				authorType: "human",
				content: "Check this",
			});

			const thread = await backend.createThread(testAnchor, msg);

			expect(thread.id).toBeTruthy();
			expect(thread.anchor).toEqual(testAnchor);
			expect(thread.status).toBe("open");
			expect(thread.messages).toHaveLength(1);
			expect(thread.messages[0]!.content).toBe("Check this");
		});

		it("persists the thread to sidecar storage", async () => {
			const msg = createMessage({
				author: "remi",
				authorType: "human",
				content: "Persisted",
			});

			await backend.createThread(testAnchor, msg);

			// Reload from storage to verify persistence
			const loaded = await storage.load(docFile);
			expect(loaded).toHaveLength(1);
			expect(loaded[0]!.messages[0]!.content).toBe("Persisted");
		});

		it("creates thread without first message", async () => {
			const thread = await backend.createThread(testAnchor);

			expect(thread.id).toBeTruthy();
			expect(thread.anchor).toEqual(testAnchor);
			expect(thread.status).toBe("open");
			expect(thread.messages).toHaveLength(0);
		});

		it("fires onNewThread callback", async () => {
			const callback = vi.fn();
			backend.onNewThread(callback);

			const msg = createMessage({
				author: "remi",
				authorType: "human",
				content: "Hello",
			});

			const thread = await backend.createThread(testAnchor, msg);

			expect(callback).toHaveBeenCalledOnce();
			expect(callback).toHaveBeenCalledWith(thread);
		});
	});

	describe("addMessage", () => {
		it("appends message and updates updatedAt", async () => {
			const firstMsg = createMessage({
				author: "remi",
				authorType: "human",
				content: "First",
			});
			const thread = await backend.createThread(testAnchor, firstMsg);
			const originalUpdatedAt = thread.updatedAt;

			// Small delay to ensure different timestamp
			await new Promise((r) => setTimeout(r, 5));

			const secondMsg = createMessage({
				author: "agent",
				authorType: "agent",
				content: "Response",
			});
			await backend.addMessage(thread.id, secondMsg);

			const threads = backend.getThreads();
			const updated = threads.find((t) => t.id === thread.id)!;
			expect(updated.messages).toHaveLength(2);
			expect(updated.messages[1]!.content).toBe("Response");
			expect(updated.updatedAt).not.toBe(originalUpdatedAt);
		});

		it("fires onNewMessage callback", async () => {
			const callback = vi.fn();
			backend.onNewMessage(callback);

			const firstMsg = createMessage({
				author: "remi",
				authorType: "human",
				content: "First",
			});
			const thread = await backend.createThread(testAnchor, firstMsg);

			const secondMsg = createMessage({
				author: "agent",
				authorType: "agent",
				content: "Response",
			});
			await backend.addMessage(thread.id, secondMsg);

			expect(callback).toHaveBeenCalledOnce();
			expect(callback).toHaveBeenCalledWith(thread.id, secondMsg);
		});

		it("throws for non-existent thread", async () => {
			const msg = createMessage({
				author: "remi",
				authorType: "human",
				content: "Hello",
			});

			await expect(
				backend.addMessage("nonexistent-id", msg),
			).rejects.toThrow("not found");
		});
	});

	describe("resolveThread", () => {
		it("sets status to 'resolved'", async () => {
			const msg = createMessage({
				author: "remi",
				authorType: "human",
				content: "Resolve me",
			});
			const thread = await backend.createThread(testAnchor, msg);

			await backend.resolveThread(thread.id);

			const threads = backend.getThreads();
			const resolved = threads.find((t) => t.id === thread.id)!;
			expect(resolved.status).toBe("resolved");
		});
	});

	describe("reopenThread", () => {
		it("sets status back to 'open'", async () => {
			const msg = createMessage({
				author: "remi",
				authorType: "human",
				content: "Toggle",
			});
			const thread = await backend.createThread(testAnchor, msg);

			await backend.resolveThread(thread.id);
			await backend.reopenThread(thread.id);

			const threads = backend.getThreads();
			const reopened = threads.find((t) => t.id === thread.id)!;
			expect(reopened.status).toBe("open");
		});
	});

	describe("acceptSuggestion", () => {
		it("marks suggestion as 'accepted' and replaces document text", async () => {
			const suggestion = createSuggestion({
				originalText: "test document",
				replacementText: "example document",
			});
			const msg = createMessage({
				author: "WriterAgent",
				authorType: "agent",
				content: "Here's a suggestion",
				suggestion,
			});
			const thread = await backend.createThread(testAnchor, msg);

			await backend.acceptSuggestion(thread.id, msg.id);

			// Check suggestion status
			const threads = backend.getThreads();
			const updated = threads.find((t) => t.id === thread.id)!;
			expect(updated.messages[0]!.suggestion!.status).toBe("accepted");

			// Check document was modified
			const content = await vault.read(docFile);
			expect(content).toContain("example document");
			expect(content).not.toContain("test document");
		});

		it("updates other thread anchors that shifted", async () => {
			// Create two threads: one before and one after
			const msg1 = createMessage({
				author: "remi",
				authorType: "human",
				content: "First thread",
			});
			await backend.createThread(
				{
					anchorText: "some text",
					startOffset: 36,
					endOffset: 45,
				},
				msg1,
			);

			const suggestion = createSuggestion({
				originalText: "test document",
				replacementText: "long replacement text here",
			});
			const msg2 = createMessage({
				author: "agent",
				authorType: "agent",
				content: "Suggestion",
				suggestion,
			});
			const threadWithSuggestion = await backend.createThread(testAnchor, msg2);

			await backend.acceptSuggestion(threadWithSuggestion.id, msg2.id);

			// The second thread's anchor should have shifted
			const threads = backend.getThreads();
			const otherThread = threads.find((t) => t.id !== threadWithSuggestion.id)!;
			// The replacement is 13 chars longer ("long replacement text here" - "test document" = 13 more)
			expect(otherThread.anchor.startOffset).toBe(36 + 13);
		});

		it("rejects suggestion when originalText exists elsewhere but not at anchor", async () => {
			// Document has "test document" at offset 17-30, but also add it elsewhere
			const extendedContent = docContent + " This also has test document in it.";
			await vault.modify(docFile, extendedContent);

			// Create a thread anchored to the second occurrence's region ("also has")
			const anchor: TextAnchor = {
				anchorText: "also has",
				startOffset: extendedContent.indexOf("also has"),
				endOffset: extendedContent.indexOf("also has") + "also has".length,
			};
			const suggestion = createSuggestion({
				originalText: "test document",
				replacementText: "replacement",
			});
			const msg = createMessage({
				author: "agent",
				authorType: "agent",
				content: "Wrong anchor",
				suggestion,
			});
			const thread = await backend.createThread(anchor, msg);

			// "test document" exists in the full document but NOT within the anchor range "also has"
			await expect(
				backend.acceptSuggestion(thread.id, msg.id),
			).rejects.toThrow("not found at anchor position");

			// Document should be unchanged
			const content = await vault.read(docFile);
			expect(content).toBe(extendedContent);
		});

		it("throws when originalText doesn't match — document unchanged", async () => {
			// Modify the document so the original text is gone
			await vault.modify(docFile, "Completely different content");

			const suggestion = createSuggestion({
				originalText: "test document",
				replacementText: "replacement",
			});
			const msg = createMessage({
				author: "agent",
				authorType: "agent",
				content: "Stale suggestion",
				suggestion,
			});
			const thread = await backend.createThread(testAnchor, msg);

			await expect(
				backend.acceptSuggestion(thread.id, msg.id),
			).rejects.toThrow("not found");

			// Document should be unchanged
			const content = await vault.read(docFile);
			expect(content).toBe("Completely different content");

			// Suggestion should still be pending
			const threads = backend.getThreads();
			const t = threads.find((th) => th.id === thread.id)!;
			expect(t.messages[0]!.suggestion!.status).toBe("pending");
		});
	});

	describe("rejectSuggestion", () => {
		it("marks suggestion as 'rejected' and leaves document unchanged", async () => {
			const suggestion = createSuggestion({
				originalText: "test document",
				replacementText: "replacement",
			});
			const msg = createMessage({
				author: "agent",
				authorType: "agent",
				content: "Suggestion",
				suggestion,
			});
			const thread = await backend.createThread(testAnchor, msg);

			await backend.rejectSuggestion(thread.id, msg.id);

			// Check suggestion status
			const threads = backend.getThreads();
			const updated = threads.find((t) => t.id === thread.id)!;
			expect(updated.messages[0]!.suggestion!.status).toBe("rejected");

			// Document should be unchanged
			const content = await vault.read(docFile);
			expect(content).toBe(docContent);
		});
	});

	describe("double accept/reject", () => {
		it("throws on double accept", async () => {
			const suggestion = createSuggestion({
				originalText: "test document",
				replacementText: "replacement",
			});
			const msg = createMessage({
				author: "agent",
				authorType: "agent",
				content: "Suggestion",
				suggestion,
			});
			const thread = await backend.createThread(testAnchor, msg);

			await backend.acceptSuggestion(thread.id, msg.id);

			await expect(
				backend.acceptSuggestion(thread.id, msg.id),
			).rejects.toThrow("already");
		});

		it("throws on reject after accept", async () => {
			const suggestion = createSuggestion({
				originalText: "test document",
				replacementText: "replacement",
			});
			const msg = createMessage({
				author: "agent",
				authorType: "agent",
				content: "Suggestion",
				suggestion,
			});
			const thread = await backend.createThread(testAnchor, msg);

			await backend.acceptSuggestion(thread.id, msg.id);

			await expect(
				backend.rejectSuggestion(thread.id, msg.id),
			).rejects.toThrow("already");
		});
	});

	describe("connectionStatus", () => {
		it("is always 'offline' for local backend", () => {
			expect(backend.connectionStatus).toBe("offline");
		});
	});
});
