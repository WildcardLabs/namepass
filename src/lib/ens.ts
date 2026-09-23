/**
 * ENS profile client.
 *
 * Source: https://api.resolvio.xyz/ens/v2/profile/<name>
 *
 * The API returns every record slot it knows about, most of them with
 * `exists: false`. We keep only the records a person reads, and drop the
 * `addresses` array entirely — coin types like 2147492101 are noise for
 * someone who just wants to know whose name this is. The one address worth
 * showing is coin 60 (ETH), which we lift out as `addr`.
 */

const BASE = "https://api.resolvio.xyz/ens/v2/profile";

interface ApiTextRecord {
	key: string;
	value?: string;
	exists: boolean;
}

interface ApiAddress {
	coin: number;
	chain: string;
	value?: string;
	exists: boolean;
}

interface ApiProfile {
	name: string;
	texts?: ApiTextRecord[];
	addresses?: ApiAddress[];
	contenthash?: { value?: string; exists: boolean };
	resolver?: string;
}

/** Records we surface, in display order. Everything else is ignored. */
export const DISPLAY_KEYS = [
	"description",
	"url",
	"com.twitter",
	"com.github",
	"org.telegram",
	"location",
	"email",
] as const;

const SOCIAL_PROFILES: Record<string, { base: string; hosts: readonly string[]; handle: RegExp }> = {
	"com.twitter": {
		base: "https://x.com/",
		hosts: ["x.com", "www.x.com", "twitter.com", "www.twitter.com"],
		handle: /^[A-Za-z0-9_]{1,15}$/,
	},
	"com.github": {
		base: "https://github.com/",
		hosts: ["github.com", "www.github.com"],
		handle: /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/,
	},
	"org.telegram": {
		base: "https://t.me/",
		hosts: ["t.me", "www.t.me", "telegram.me", "www.telegram.me"],
		handle: /^[A-Za-z0-9_]{5,32}$/,
	},
};

function httpProfileUrl(value: string): string | undefined {
	if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^https?:\/\//i.test(value)) return undefined;
	const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
	try {
		const url = new URL(candidate);
		if (url.username || url.password) return undefined;
		return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
	} catch {
		return undefined;
	}
}

/** Return a web link only for profile records whose values represent URLs or handles. */
export function profileRecordHref(key: string, value: string): string | undefined {
	const raw = value.trim();
	if (!raw) return undefined;
	if (key === "url") return httpProfileUrl(raw);

	const social = SOCIAL_PROFILES[key];
	if (!social) return undefined;

	if (/^https?:\/\//i.test(raw) || /^(?:www\.)?(?:x\.com|twitter\.com|github\.com|t\.me|telegram\.me)\//i.test(raw)) {
		const url = httpProfileUrl(raw);
		if (!url) return undefined;
		return social.hosts.includes(new URL(url).hostname.toLowerCase()) ? url : undefined;
	}

	const handle = raw.replace(/^@/, "");
	return social.handle.test(handle) ? `${social.base}${encodeURIComponent(handle)}` : undefined;
}

export function profileRecordLabel(key: string, value: string): string {
	if (key !== "com.twitter" && key !== "org.telegram") return value;
	const raw = value.trim();
	if (/^(?:https?:\/\/|www\.|(?:x\.com|twitter\.com|t\.me|telegram\.me)\/)/i.test(raw)) return raw;
	return `@${raw.replace(/^@/, "")}`;
}

export interface EnsProfile {
	name: string;
	/** ETH address (coin 60), if set. */
	addr?: string;
	avatar?: string;
	/** Curated text records, keyed as the API keys them. */
	text: Record<string, string>;
	/** Present when the name serves a site. */
	contenthash?: string;
	resolver?: string;
}

const cache = new Map<string, EnsProfile | null>();
const inflight = new Map<string, Promise<EnsProfile | null>>();

function shape(raw: ApiProfile): EnsProfile {
	const texts = raw.texts ?? [];
	const byKey = new Map(
		texts.filter((t) => t.exists && t.value).map((t) => [t.key, t.value as string]),
	);

	const text: Record<string, string> = {};
	for (const key of DISPLAY_KEYS) {
		const value = byKey.get(key);
		if (value) text[key] = value;
	}

	const eth = (raw.addresses ?? []).find((a) => a.coin === 60 && a.exists);

	return {
		name: raw.name,
		addr: eth?.value,
		avatar: byKey.get("avatar"),
		text,
		contenthash: raw.contenthash?.exists ? raw.contenthash.value : undefined,
		resolver: raw.resolver,
	};
}

/**
 * Fetch a profile. Returns null when the name has no resolver data or the
 * request fails — callers should treat null as "nothing to show", not an error.
 *
 * **Takes no AbortSignal, on purpose.** Requests are deduplicated, so the
 * promise one caller gets back is shared with every other caller waiting on
 * the same name — `NameAvatar` and `NameDetail` routinely want the same one at
 * the same moment. Binding the underlying `fetch` to a single caller's signal
 * means that caller's unmount cancels the request for all of them, which
 * surfaces as a profile that renders blank forever: the abort resolves `null`,
 * nothing is cached, and nothing re-fetches because the shared promise was
 * already consumed. Under StrictMode's double-invoked effects that is close to
 * a certainty rather than a race.
 *
 * A caller that stops caring should ignore the result rather than cancel it —
 * letting an abandoned request finish also warms the cache for the next mount.
 */
export async function fetchProfile(name: string): Promise<EnsProfile | null> {
	const key = name.toLowerCase();
	if (cache.has(key)) return cache.get(key)!;

	const existing = inflight.get(key);
	if (existing) return existing;

	const request = (async () => {
		try {
			const res = await fetch(`${BASE}/${encodeURIComponent(key)}`);
			if (!res.ok) {
				cache.set(key, null);
				return null;
			}
			const raw = (await res.json()) as ApiProfile;
			const profile = shape(raw);
			cache.set(key, profile);
			return profile;
		} catch {
			/* Offline or DNS failure — don't cache, so the next mount retries. */
			return null;
		} finally {
			inflight.delete(key);
		}
	})();

	inflight.set(key, request);
	return request;
}
