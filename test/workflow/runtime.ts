import { sleep } from "workflow";

async function checkpoint(value: string): Promise<string> {
	"use step";
	return value;
}

export async function runtimeProbe(value: string): Promise<string> {
	"use workflow";
	const saved = await checkpoint(value);
	await sleep("1h");
	return checkpoint(`${saved}:resumed`);
}
