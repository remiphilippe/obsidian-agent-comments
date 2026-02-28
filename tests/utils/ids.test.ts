import { describe, it, expect, vi, afterEach } from "vitest";
import { generateId, nowISO } from "../../src/utils/ids";

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("generateId", () => {
	it("returns a valid UUID v4 format", () => {
		const id = generateId();
		expect(id).toMatch(UUID_V4_REGEX);
	});

	it("returns unique values across 1000 calls", () => {
		const ids = new Set<string>();
		for (let i = 0; i < 1000; i++) {
			ids.add(generateId());
		}
		expect(ids.size).toBe(1000);
	});
});

describe("generateId fallback", () => {
	const originalRandomUUID = crypto.randomUUID;

	afterEach(() => {
		// Restore original
		Object.defineProperty(crypto, "randomUUID", {
			value: originalRandomUUID,
			writable: true,
			configurable: true,
		});
	});

	it("uses fallback when crypto.randomUUID is undefined", () => {
		Object.defineProperty(crypto, "randomUUID", {
			value: undefined,
			writable: true,
			configurable: true,
		});

		const id = generateId();
		expect(id).toMatch(UUID_V4_REGEX);
	});

	it("fallback produces unique values", () => {
		Object.defineProperty(crypto, "randomUUID", {
			value: undefined,
			writable: true,
			configurable: true,
		});

		const ids = new Set<string>();
		for (let i = 0; i < 100; i++) {
			ids.add(generateId());
		}
		expect(ids.size).toBe(100);
	});
});

describe("nowISO", () => {
	it("returns a valid ISO 8601 string", () => {
		const iso = nowISO();
		// ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
		expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
	});

	it("returns current time (within 1 second)", () => {
		const before = Date.now();
		const iso = nowISO();
		const after = Date.now();
		const parsed = new Date(iso).getTime();
		expect(parsed).toBeGreaterThanOrEqual(before);
		expect(parsed).toBeLessThanOrEqual(after);
	});
});
