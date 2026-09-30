import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

export async function getDepositAddress(origin, name, signal) {
	const response = await fetch(`${origin.replace(/\/$/, "")}/api/v1/address`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ name }),
		signal,
	});
	if (!response.ok)
		throw new Error(
			`Namepass returned ${response.status}: ${await response.text()}`,
		);
	return response.json();
}

export async function estimateRenewal(origin, name, chainId, amount, signal) {
	const response = await fetch(`${origin.replace(/\/$/, "")}/api/v1/quote`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ name, chainId, amount }),
		signal,
	});
	if (!response.ok)
		throw new Error(
			`Namepass returned ${response.status}: ${await response.text()}`,
		);
	return response.json();
}

export async function getRenewalHistory(origin, name, cursor, signal) {
	const url = new URL(
		`${origin.replace(/\/$/, "")}/api/v1/names/${encodeURIComponent(name)}/renewals`,
	);
	if (cursor) url.searchParams.set("cursor", cursor);
	const response = await fetch(url, { signal });
	if (!response.ok)
		throw new Error(
			`Namepass returned ${response.status}: ${await response.text()}`,
		);
	return response.json();
}

export async function waitForRenewal(origin, chainId, transactionHash, signal) {
	const url = new URL(
		`${origin.replace(/\/$/, "")}/api/v1/status/${encodeURIComponent(chainId)}`,
	);
	url.searchParams.set("transactionHash", transactionHash);
	for (;;) {
		const response = await fetch(url, { signal });
		if (response.ok) {
			const result = await response.json();
			if (result.status === "complete") return result;
			if (result.status === "failed")
				throw new Error(
					"Source transaction invalidated. Inspect it before taking further action.",
				);
		} else if (![404, 429, 503].includes(response.status)) {
			throw new Error(
				`Namepass returned ${response.status}: ${await response.text()}`,
			);
		}
		const retry = Number(response.headers.get("retry-after") ?? 5);
		await sleep(
			Number.isFinite(retry) ? Math.max(5, retry) * 1000 : 5000,
			undefined,
			{ signal },
		);
	}
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	const [command, origin, first, second] = process.argv.slice(2);
	if (
		!origin ||
		(command !== "address" && command !== "poll") ||
		!first ||
		(command === "poll" && !second)
	) {
		console.error(
			"Usage: node namepass.mjs address <origin> <name> | poll <origin> <chainId> <transactionHash>",
		);
		process.exitCode = 1;
	} else {
		const result =
			command === "address"
				? await getDepositAddress(origin, first)
				: await waitForRenewal(
						origin,
						first,
						second,
						AbortSignal.timeout(30 * 60 * 1000),
					);
		console.log(JSON.stringify(result, null, 2));
	}
}
