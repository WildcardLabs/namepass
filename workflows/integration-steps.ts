/** Keep Node/database dependencies behind the durable step boundary. */
export async function integrationStep(
	token: string,
	role: "publication" | "evidence" | "delivery",
): Promise<boolean> {
	"use step";
	const worker = await import("../server/integrations/worker");
	return worker.integrationStep(token, role);
}
export async function finishIntegrationPump(
	token: string,
	role: "publication" | "evidence" | "delivery",
): Promise<void> {
	"use step";
	const worker = await import("../server/integrations/worker");
	await worker.finishIntegrationPump(token, role);
}
