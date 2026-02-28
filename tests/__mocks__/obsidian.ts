export class Notice {
	constructor(public message: string) {}
}

export class TFile {
	path: string;
	basename: string;
	extension: string;
	name: string;
	parent: TFolder | null;
	vault: Vault;
	stat: { ctime: number; mtime: number; size: number };

	constructor(path: string, basename: string, extension: string) {
		this.path = path;
		this.basename = basename;
		this.extension = extension;
		this.name = `${basename}.${extension}`;
		this.parent = null;
		this.vault = null!;
		this.stat = { ctime: 0, mtime: 0, size: 0 };
	}
}

export class TFolder {
	path: string;
	name: string;
	parent: TFolder | null;
	children: (TFile | TFolder)[];

	constructor(path: string) {
		this.path = path;
		this.name = path.split("/").pop() ?? path;
		this.parent = null;
		this.children = [];
	}
}

export class Vault {
	private files = new Map<string, string>();

	async read(file: TFile): Promise<string> {
		return this.files.get(file.path) ?? "";
	}

	async modify(file: TFile, data: string): Promise<void> {
		this.files.set(file.path, data);
	}

	async create(path: string, data: string): Promise<TFile> {
		this.files.set(path, data);
		const parts = path.split("/");
		const name = parts.pop() ?? path;
		const dotIdx = name.lastIndexOf(".");
		const basename = dotIdx > 0 ? name.slice(0, dotIdx) : name;
		const extension = dotIdx > 0 ? name.slice(dotIdx + 1) : "";
		return new TFile(path, basename, extension);
	}

	async adapter_exists(path: string): Promise<boolean> {
		return this.files.has(path);
	}

	async delete(file: TFile): Promise<void> {
		this.files.delete(file.path);
	}

	getAbstractFileByPath(path: string): TFile | TFolder | null {
		if (this.files.has(path)) {
			const parts = path.split("/");
			const name = parts.pop() ?? path;
			const dotIdx = name.lastIndexOf(".");
			const basename = dotIdx > 0 ? name.slice(0, dotIdx) : name;
			const extension = dotIdx > 0 ? name.slice(dotIdx + 1) : "";
			return new TFile(path, basename, extension);
		}
		return null;
	}

	// Test helper: set file content directly
	_set(path: string, content: string): void {
		this.files.set(path, content);
	}

	// Test helper: get file content directly
	_get(path: string): string | undefined {
		return this.files.get(path);
	}

	// Test helper: check file exists
	_has(path: string): boolean {
		return this.files.has(path);
	}
}

export const Platform = { isMobile: false, isDesktop: true };

export class Plugin {
	app: { vault: Vault; workspace: MockWorkspace };
	manifest: Record<string, unknown>;

	constructor() {
		this.app = { vault: new Vault(), workspace: new MockWorkspace() };
		this.manifest = {};
	}

	// eslint-disable-next-line @typescript-eslint/no-empty-function
	async onload(): Promise<void> {}
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	onunload(): void {}
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	async loadData(): Promise<unknown> { return null; }
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	async saveData(_data: unknown): Promise<void> {}
	addCommand(_command: unknown): unknown { return _command; }
	addRibbonIcon(_icon: string, _title: string, _callback: () => void): HTMLElement {
		return document.createElement("div");
	}
	registerView(_type: string, _viewCreator: unknown): void {}
	registerEditorExtension(_extension: unknown): void {}
	addSettingTab(_tab: unknown): void {}
}

export class PluginSettingTab {
	app: unknown;
	plugin: unknown;
	containerEl: HTMLElement;

	constructor(app: unknown, plugin: unknown) {
		this.app = app;
		this.plugin = plugin;
		this.containerEl = document.createElement("div");
	}

	display(): void {}
	hide(): void {}
}

export class ItemView {
	app: unknown;
	containerEl: HTMLElement;
	contentEl: HTMLElement;

	constructor() {
		this.app = {};
		this.containerEl = document.createElement("div");
		this.contentEl = document.createElement("div");
	}

	getViewType(): string { return ""; }
	getDisplayText(): string { return ""; }
	getIcon(): string { return ""; }
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	async onOpen(): Promise<void> {}
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	async onClose(): Promise<void> {}
}

export class MarkdownRenderer {
	static async render(
		_app: unknown,
		_markdown: string,
		el: HTMLElement,
		_sourcePath: string,
		_component: unknown,
	): Promise<void> {
		el.textContent = _markdown;
	}
}

export class Setting {
	settingEl: HTMLElement;
	nameEl: HTMLElement;
	descEl: HTMLElement;
	controlEl: HTMLElement;

	constructor(_containerEl: HTMLElement) {
		this.settingEl = document.createElement("div");
		this.nameEl = document.createElement("div");
		this.descEl = document.createElement("div");
		this.controlEl = document.createElement("div");
	}

	setName(_name: string): this { return this; }
	setDesc(_desc: string): this { return this; }
	addText(_cb: (text: unknown) => unknown): this { return this; }
	addToggle(_cb: (toggle: unknown) => unknown): this { return this; }
	addDropdown(_cb: (dropdown: unknown) => unknown): this { return this; }
}

class MockWorkspace {
	on(_event: string, _callback: (...args: unknown[]) => void): { id: string } {
		return { id: "mock-event" };
	}
	onLayoutReady(callback: () => void): void {
		callback();
	}
	getLeavesOfType(_type: string): unknown[] {
		return [];
	}
	getRightLeaf(_split: boolean): unknown {
		return { setViewState: async () => {} };
	}
	revealLeaf(_leaf: unknown): void {}
}

export class Modal {
	app: unknown;
	contentEl: HTMLElement;
	modalEl: HTMLElement;

	constructor(app: unknown) {
		this.app = app;
		this.contentEl = document.createElement("div");
		this.modalEl = document.createElement("div");
	}

	open(): void {}
	close(): void {}
	onOpen(): void {}
	onClose(): void {}
}
