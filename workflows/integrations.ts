import { sleep } from "workflow";
import { integrationStep, finishIntegrationPump } from "./integration-steps";

/** A bounded run; cron repairs a lost wake or lease. Each step is safe to repeat. */
export async function integrationPump(
	token: string,
	role: "publication" | "evidence" | "delivery",
) {
	"use workflow";
	for (let i = 0; i < 60; i++) {
		const worked = await integrationStep(token, role);
		if (!worked && i >= 5) break;
		await sleep(worked ? "1s" : "10s");
	}
	await finishIntegrationPump(token, role);
}
