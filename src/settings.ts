/**
 * Plugin settings — user-configurable options in Obsidian's settings panel.
 */

import { App, PluginSettingTab, Setting } from "obsidian";
import type AgentCommentsPlugin from "./main";

export interface AgentCommentsSettings {
	backendType: "local" | "websocket" | "rest";
	websocketUrl: string;
	restUrl: string;
	defaultAuthorName: string;
	showResolvedThreads: boolean;
	showOrphanedNotice: boolean;
}

export const DEFAULT_SETTINGS: AgentCommentsSettings = {
	backendType: "local",
	websocketUrl: "",
	restUrl: "",
	defaultAuthorName: "human",
	showResolvedThreads: false,
	showOrphanedNotice: true,
};

export class AgentCommentsSettingTab extends PluginSettingTab {
	plugin: AgentCommentsPlugin;

	constructor(app: App, plugin: AgentCommentsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/* eslint-disable obsidianmd/ui/sentence-case -- proper nouns (WebSocket, REST API) and URL placeholders */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Backend type")
			.setDesc("How the plugin communicates with AI agents.")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("local", "Local (sidecar files only)")
					.addOption("websocket", "WebSocket")
					.addOption("rest", "REST API")
					.setValue(this.plugin.settings.backendType)
					.onChange(async (value) => {
						this.plugin.settings.backendType = value as AgentCommentsSettings["backendType"];
						await this.plugin.saveSettings();
						this.plugin.recreateBackend();
						this.display();
					});
			});

		if (this.plugin.settings.backendType === "websocket") {
			new Setting(containerEl)
				.setName("WebSocket URL")
				.setDesc("WebSocket endpoint for agent communication (e.g., wss://localhost:8080).")
				.addText((text) => {
					text
						.setPlaceholder("wss://localhost:8080")
						.setValue(this.plugin.settings.websocketUrl)
						.onChange(async (value) => {
							if (value && !this.isValidWsUrl(value)) {
								return;
							}
							this.plugin.settings.websocketUrl = value;
							await this.plugin.saveSettings();
							this.plugin.recreateBackend();
						});
				});
		}

		if (this.plugin.settings.backendType === "rest") {
			new Setting(containerEl)
				.setName("REST API URL")
				.setDesc("REST endpoint for agent communication (e.g., https://localhost:8080/api).")
				.addText((text) => {
					text
						.setPlaceholder("https://localhost:8080/api")
						.setValue(this.plugin.settings.restUrl)
						.onChange(async (value) => {
							if (value && !this.isValidHttpUrl(value)) {
								return;
							}
							this.plugin.settings.restUrl = value;
							await this.plugin.saveSettings();
							this.plugin.recreateBackend();
						});
				});
		}

		new Setting(containerEl)
			.setName("Default author name")
			.setDesc("Your display name in comment threads.")
			.addText((text) => {
				text
					.setPlaceholder("human")
					.setValue(this.plugin.settings.defaultAuthorName)
					.onChange(async (value) => {
						this.plugin.settings.defaultAuthorName = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Show resolved threads")
			.setDesc("Display resolved threads in the gutter and sidebar.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.showResolvedThreads)
					.onChange(async (value) => {
						this.plugin.settings.showResolvedThreads = value;
						await this.plugin.saveSettings();
						this.plugin.updateShowResolved(value);
					});
			});

		new Setting(containerEl)
			.setName("Show orphaned thread notice")
			.setDesc("Display a notice when threads become orphaned due to text deletion.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.showOrphanedNotice)
					.onChange(async (value) => {
						this.plugin.settings.showOrphanedNotice = value;
						await this.plugin.saveSettings();
					});
			});
	}
	/* eslint-enable obsidianmd/ui/sentence-case */

	private isValidWsUrl(url: string): boolean {
		try {
			const parsed = new URL(url);
			return parsed.protocol === "ws:" || parsed.protocol === "wss:";
		} catch {
			return false;
		}
	}

	private isValidHttpUrl(url: string): boolean {
		try {
			const parsed = new URL(url);
			return parsed.protocol === "http:" || parsed.protocol === "https:";
		} catch {
			return false;
		}
	}
}
