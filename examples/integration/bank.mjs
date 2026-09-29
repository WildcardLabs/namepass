// Register an already-sent payment. This example never signs or sends funds.
const [name, chainId, txHash, reference] = process.argv.slice(2);
if (
	!name ||
	!chainId ||
	!txHash ||
	!reference ||
	!process.env.NAMEPASS_API ||
	!process.env.NAMEPASS_API_KEY
)
	throw new Error(
		"Usage: bank.mjs name chainId txHash reference; set NAMEPASS_API and NAMEPASS_API_KEY.",
	);
async function command(path, body, idempotencyKey) {
	const response = await fetch(process.env.NAMEPASS_API + path, {
		method: "POST",
		headers: {
			authorization: "Bearer " + process.env.NAMEPASS_API_KEY,
			"content-type": "application/json",
			"idempotency-key": idempotencyKey,
		},
		body: JSON.stringify(body),
	});
	const data = await response.json();
	if (!response.ok)
		throw new Error(`${data.error?.code}: ${data.error?.message}`);
	return data;
}
const activation = await command(
	"/names/activate",
	{ name },
	reference + "-activate",
);
console.log({ activation });
const transfer = await command(
	"/transfers",
	{ name, chainId, txHash, reference },
	reference + "-report",
);
console.log({ transfer });
