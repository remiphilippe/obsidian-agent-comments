/**
 * UUID generation and timestamp utilities.
 */

/**
 * Generates a UUID v4 string.
 * Uses `crypto.randomUUID()` when available, with a fallback
 * implementation for environments that lack it (older mobile Safari).
 */
export function generateId(): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}
	return fallbackUUID();
}

/**
 * RFC 4122 v4 compliant UUID using `crypto.getRandomValues()`,
 * which is available everywhere Obsidian runs.
 */
function fallbackUUID(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);

	// Set version (4) and variant (10xx) bits per RFC 4122
	bytes[6] = (bytes[6]! & 0x0f) | 0x40;
	bytes[8] = (bytes[8]! & 0x3f) | 0x80;

	const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
	return [
		hex.slice(0, 8),
		hex.slice(8, 12),
		hex.slice(12, 16),
		hex.slice(16, 20),
		hex.slice(20, 32),
	].join("-");
}

/**
 * Returns the current time as an ISO 8601 string.
 */
export function nowISO(): string {
	return new Date().toISOString();
}
