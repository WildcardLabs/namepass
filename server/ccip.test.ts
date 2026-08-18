import assert from "node:assert/strict";
import test from "node:test";

import ccipRoute from "../routes/api/ccip";
import { GATEWAY_TRUE, decodeCcipLabel, handleCcipGateway } from "./ccip";
import type { CcipGatewayDeps } from "./ccip";

/** Encode a label the way the resolver's call data carries it: raw UTF-8 bytes. */
function labelData(label: string): string {
	return "0x" + Buffer.from(label, "utf8").toString("hex");
}

function trackingDeps(): { deps: CcipGatewayDeps; registered: string[] } {
	const set = new Set<string>();
	const registered: string[] = [];
	return {
		registered,
		deps: {
			isRegistered: (label) => Promise.resolve(set.has(label)),
			register: (label) => {
				registered.push(label);
				set.add(label);
				return Promise.resolve();
			},
		},
	};
}

test("decodeCcipLabel accepts a canonical label and rejects the rest", () => {
	assert.equal(decodeCcipLabel(labelData("vitalik")), "vitalik");
	assert.equal(decodeCcipLabel(labelData("nick")), "nick");

	assert.throws(() => decodeCcipLabel(labelData("Vitalik")), /normal/i); // non-canonical casing
	assert.throws(() => decodeCcipLabel(labelData("vitalik.eth"))); // dotted / suffixed
	assert.throws(() => decodeCcipLabel(labelData("ab"))); // shorter than the ENS floor
	assert.throws(() => decodeCcipLabel("0x")); // empty call data
	assert.throws(() => decodeCcipLabel("vitalik")); // not 0x-hex
	assert.throws(() => decodeCcipLabel("0xfffe")); // not valid UTF-8
});

test("the gateway registers a new label once and confirms with abi-encoded true", async () => {
	const { deps, registered } = trackingDeps();
	assert.equal(await handleCcipGateway(labelData("vitalik"), deps), GATEWAY_TRUE);
	assert.deepEqual(registered, ["vitalik"]);

	// A second resolution of a known name takes the fast path — no second register.
	assert.equal(await handleCcipGateway(labelData("vitalik"), deps), GATEWAY_TRUE);
	assert.deepEqual(registered, ["vitalik"]);
});

test("the gateway still confirms when the balance scan fails but the label is tracked", async () => {
	let tracked = false;
	const deps: CcipGatewayDeps = {
		isRegistered: () => Promise.resolve(tracked),
		register: () => {
			tracked = true; // watched address written before the scan fails
			return Promise.reject(new Error("balance scan failed"));
		},
	};
	assert.equal(await handleCcipGateway(labelData("goodname"), deps), GATEWAY_TRUE);
});

test("the gateway fails the read when registration leaves the label untracked", async () => {
	const deps: CcipGatewayDeps = {
		isRegistered: () => Promise.resolve(false),
		register: () => Promise.reject(new Error("database unavailable")),
	};
	await assert.rejects(() => handleCcipGateway(labelData("newname"), deps), /database unavailable/);
});

test("the gateway answers CORS preflight and rejects other methods", async () => {
	const preflight = await ccipRoute.fetch(
		new Request("https://namepass.test/api/ccip", { method: "OPTIONS" }),
	);
	assert.equal(preflight.status, 204);
	assert.equal(preflight.headers.get("access-control-allow-origin"), "*");

	const wrong = await ccipRoute.fetch(
		new Request("https://namepass.test/api/ccip", { method: "PUT" }),
	);
	assert.equal(wrong.status, 405);
	assert.equal(wrong.headers.get("access-control-allow-origin"), "*");
});

test("the gateway rejects a non-normalized label before any database work", async () => {
	const response = await ccipRoute.fetch(
		new Request("https://namepass.test/api/ccip", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ data: labelData("Vitalik"), sender: "0x0000000000000000000000000000000000000001" }),
		}),
	);
	assert.equal(response.status, 400);
	assert.equal(response.headers.get("access-control-allow-origin"), "*");
});
