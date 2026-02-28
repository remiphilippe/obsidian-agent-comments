/**
 * Backend factory — creates the appropriate backend based on settings.
 *
 * - Local backend: direct sidecar-only storage (no wrapper needed)
 * - WebSocket backend: wrapped with OfflineAwareBackend for sidecar-first writes
 * - REST backend: wrapped with OfflineAwareBackend for sidecar-first writes
 */

import { Vault } from "obsidian";
import type { AgentCommentsSettings } from "../settings";
import type { AgentCommentsBackend } from "../models/backend";
import { SidecarStorage } from "../storage/sidecar";
import { LocalBackend } from "./local";
import { WebSocketBackend } from "./websocket";
import { RestBackend } from "./rest";
import { OfflineAwareBackend } from "./offline";

/**
 * Creates the appropriate backend based on user settings.
 * Network backends (WebSocket, REST) are wrapped with OfflineAwareBackend
 * for offline resilience. LocalBackend is used directly.
 */
export function createBackend(
	settings: AgentCommentsSettings,
	vault: Vault,
	storage: SidecarStorage,
): AgentCommentsBackend & { setActiveDocument?(file: import("obsidian").TFile): Promise<void>; getThreads?(): import("../models/thread").CommentThread[]; clearOutbox?(): void; disconnect?(): void; connect?(): Promise<void> } {
	switch (settings.backendType) {
		case "websocket": {
			if (!settings.websocketUrl) {
				// No URL configured — fall back to local
				console.warn("[agent-comments] WebSocket URL not configured, falling back to local backend");
				return new LocalBackend(storage, vault);
			}
			try {
				const wsBackend = new WebSocketBackend(settings.websocketUrl);
				return new OfflineAwareBackend(wsBackend, storage, vault);
			} catch (err) {
				console.warn("[agent-comments] Failed to create WebSocket backend, falling back to local:", err);
				return new LocalBackend(storage, vault);
			}
		}

		case "rest": {
			if (!settings.restUrl) {
				console.warn("[agent-comments] REST URL not configured, falling back to local backend");
				return new LocalBackend(storage, vault);
			}
			try {
				const restBackend = new RestBackend(settings.restUrl);
				return new OfflineAwareBackend(restBackend, storage, vault);
			} catch (err) {
				console.warn("[agent-comments] Failed to create REST backend, falling back to local:", err);
				return new LocalBackend(storage, vault);
			}
		}

		case "local":
		default:
			return new LocalBackend(storage, vault);
	}
}
