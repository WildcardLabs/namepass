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
 */
export async function fetchProfile(
	name: string,
	signal?: AbortSignal,
): Promise<EnsProfile | null> {
	const key = name.toLowerCase();
	if (cache.has(key)) return cache.get(key)!;

	const existing = inflight.get(key);
	if (existing) return existing;

	const request = (async () => {
		try {
			const res = await fetch(`${BASE}/${encodeURIComponent(key)}`, { signal });
			if (!res.ok) {
				cache.set(key, null);
				return null;
			}
			const raw = (await res.json()) as ApiProfile;
			const profile = shape(raw);
			cache.set(key, profile);
			return profile;
		} catch {
			/* Aborted or offline — don't poison the cache. */
			return null;
		} finally {
			inflight.delete(key);
		}
	})();

	inflight.set(key, request);
	return request;
}
