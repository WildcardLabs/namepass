import { describe, expect, test } from "vitest";
import { profileRecordHref } from "./ens";

describe("ENS profile record links", () => {
	test("opens website records as HTTP links", () => {
		expect(profileRecordHref("url", "namepass.eth")).toBe("https://namepass.eth/");
	});

	test("maps social usernames to their profile pages", () => {
		expect(profileRecordHref("com.twitter", "@namepass_eth")).toBe("https://x.com/namepass_eth");
		expect(profileRecordHref("com.github", "namepass-labs")).toBe("https://github.com/namepass-labs");
		expect(profileRecordHref("org.telegram", "namepass")).toBe("https://t.me/namepass");
	});

	test("accepts full social profile URLs only on the matching service", () => {
		expect(profileRecordHref("com.twitter", "twitter.com/namepass_eth")).toBe("https://twitter.com/namepass_eth");
		expect(profileRecordHref("com.github", "https://github.com/namepass-labs")).toBe("https://github.com/namepass-labs");
		expect(profileRecordHref("org.telegram", "https://t.me/namepass")).toBe("https://t.me/namepass");
		expect(profileRecordHref("com.twitter", "https://evil.example/namepass_eth")).toBeUndefined();
		expect(profileRecordHref("com.twitter", "https://user:password@x.com/namepass_eth")).toBeUndefined();
	});

	test("leaves non-link records and unsupported usernames as text", () => {
		expect(profileRecordHref("location", "London")).toBeUndefined();
		expect(profileRecordHref("email", "hello@example.com")).toBeUndefined();
		expect(profileRecordHref("com.discord", "namepass#1234")).toBeUndefined();
	});

	test("does not allow non-HTTP website records", () => {
		expect(profileRecordHref("url", "javascript:alert(1)")).toBeUndefined();
		expect(profileRecordHref("url", "mailto:hello@example.com")).toBeUndefined();
	});
});
