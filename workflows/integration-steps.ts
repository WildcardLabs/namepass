/** Keep Node/database dependencies behind the durable step boundary. */
export async function integrationStep(token: string): Promise<boolean> {
	"use step";
	const worker = await import("../server/integrations/worker");
	return worker.integrationStep(token);
}
export async function finishIntegrationPump(token: string): Promise<void> {
	"use step";
	const worker = await import("../server/integrations/worker");
	await worker.finishIntegrationPump(token);
}
