import { requireCronAuthorization } from "../../../server/cron";
import { handler, json } from "../../../server/http";
import { operationsHealth } from "../../../server/operations";

export default handler("GET", async (request) => {
	requireCronAuthorization(request.headers.get("authorization"));
	const health = await operationsHealth();
	const failed = health.database !== "ok" || health.chains.some(
		(chain) => chain.gas === "critical" || chain.gas === "unavailable",
	);
	return json(health, failed ? 503 : 200);
});
