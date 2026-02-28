import { describe, it, expect, beforeEach, vi } from "vitest";
import { TFile, Vault } from "obsidian";
import { SidecarStorage } from "../../src/storage/sidecar";
import { createThread, createMessage, type CommentThread, type SidecarFile } from "../../src/models/thread";

function makeTFile(path: string): TFile {
	const parts = path.split("/");
	const name = parts.pop()!;
	const dotIdx = name.lastIndexOf(".");
	const basename = dotIdx > 0 ? name.slice(0, dotIdx) : name;
	const extension = dotIdx > 0 ? name.slice(dotIdx + 1) : "";
	return new TFile(path, basename, extension);
}

function makeValidSidecar(threads: CommentThread[]): SidecarFile {
	return {
		version: 1,
		documentId: "test.md",
		threads,
	};
}

describe("SidecarStorage", () => {
	let vault: Vault;
	let storage: SidecarStorage;

	beforeEach(() => {
		vault = new Vault();
		storage = new SidecarStorage(vault);
	});

	describe("getPath", () => {
		it("returns correct sidecar path for notes/my-article.md", () => {
			const file = makeTFile("notes/my-article.md");
			expect(storage.getPath(file)).toBe("notes/my-article.agent-comments.json");
		});

		it("returns correct sidecar path for root.md", () => {
			const file = makeTFile("root.md");
			expect(storage.getPath(file)).toBe("root.agent-comments.json");
		});

		it("throws for non-.md files", () => {
			const file = makeTFile("document.txt");
			expect(() => storage.getPath(file)).toThrow("Only .md files are supported");
		});
	});

	describe("load", () => {
		it("returns empty array for missing sidecar file", async () => {
			const file = makeTFile("test.md");
			const result = await storage.load(file);
			expect(result).toEqual([]);
		});

		it("returns typed threads from valid JSON", async () => {
			const file = makeTFile("test.md");
			const thread = createThread({
				documentId: "test.md",
				anchor: {
					anchorText: "hello",
					startOffset: 0,
					endOffset: 5,
				},
				firstMessage: createMessage({
					author: "remi",
					authorType: "human",
					content: "Test message",
				}),
			});

			const sidecar = makeValidSidecar([thread]);
			// Write directly to vault for test setup
			(vault as Vault & { _set: (p: string, c: string) => void })._set(
				"test.agent-comments.json",
				JSON.stringify(sidecar),
			);
			// Also need to make getAbstractFileByPath find it
			await vault.create("test.agent-comments.json", JSON.stringify(sidecar));

			const result = await storage.load(file);
			expect(result).toHaveLength(1);
			expect(result[0]!.id).toBe(thread.id);
			expect(result[0]!.messages).toHaveLength(1);
			expect(result[0]!.messages[0]!.author).toBe("remi");
		});

		it("returns empty array for malformed JSON (does not throw)", async () => {
			const file = makeTFile("test.md");
			await vault.create("test.agent-comments.json", "not valid json {{{");

			const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
			const result = await storage.load(file);

			expect(result).toEqual([]);
			expect(consoleSpy).toHaveBeenCalled();
			consoleSpy.mockRestore();
		});

		it("returns empty array for version 2 file with warning", async () => {
			const file = makeTFile("test.md");
			const data = { version: 2, documentId: "test.md", threads: [] };
			await vault.create("test.agent-comments.json", JSON.stringify(data));

			const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
			const result = await storage.load(file);

			expect(result).toEqual([]);
			expect(consoleSpy).toHaveBeenCalled();
			consoleSpy.mockRestore();
		});

		it("ignores extra keys in valid JSON", async () => {
			const file = makeTFile("test.md");
			const data = {
				version: 1,
				documentId: "test.md",
				threads: [],
				extraKey: "should be ignored",
			};
			await vault.create("test.agent-comments.json", JSON.stringify(data));

			const result = await storage.load(file);
			expect(result).toEqual([]);
		});
	});

	describe("saveImmediate and load round-trip", () => {
		it("saves and loads threads correctly", async () => {
			const file = makeTFile("test.md");
			const thread = createThread({
				documentId: "test.md",
				anchor: {
					anchorText: "hello world",
					startOffset: 10,
					endOffset: 21,
					sectionHeading: "## Intro",
				},
				firstMessage: createMessage({
					author: "remi",
					authorType: "human",
					content: "Check this",
				}),
			});

			await storage.saveImmediate(file, [thread]);
			const loaded = await storage.load(file);

			expect(loaded).toHaveLength(1);
			expect(loaded[0]!.id).toBe(thread.id);
			expect(loaded[0]!.anchor.anchorText).toBe("hello world");
			expect(loaded[0]!.messages[0]!.content).toBe("Check this");
		});

		it("saves valid JSON with version field", async () => {
			const file = makeTFile("test.md");
			await storage.saveImmediate(file, []);

			const sidecarPath = "test.agent-comments.json";
			const sidecarFile = vault.getAbstractFileByPath(sidecarPath);
			const content = await vault.read(sidecarFile as TFile);
			const parsed = JSON.parse(content) as SidecarFile;

			expect(parsed.version).toBe(1);
			expect(parsed.documentId).toBe("test.md");
			expect(parsed.threads).toEqual([]);
		});
	});

	describe("exists", () => {
		it("returns false when no sidecar exists", async () => {
			const file = makeTFile("test.md");
			expect(await storage.exists(file)).toBe(false);
		});

		it("returns true when sidecar exists", async () => {
			const file = makeTFile("test.md");
			await storage.saveImmediate(file, []);
			expect(await storage.exists(file)).toBe(true);
		});
	});

	describe("delete", () => {
		it("removes sidecar file", async () => {
			const file = makeTFile("test.md");
			await storage.saveImmediate(file, []);
			expect(await storage.exists(file)).toBe(true);

			await storage.delete(file);
			expect(await storage.exists(file)).toBe(false);
		});

		it("does not throw when deleting non-existent sidecar", async () => {
			const file = makeTFile("test.md");
			await expect(storage.delete(file)).resolves.toBeUndefined();
		});
	});
});
