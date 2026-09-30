import { requireCronAuthorization } from "../../../server/cron";
import { handler, json } from "../../../server/http";
import { recoverOperations } from "../../../server/operations";

export default handler("GET", async (request) => {
	requireCronAuthorization(request.headers.get("authorization"));
	const result = await recoverOperations();
	await (await import("../../../server/integrations/wake")).wakeIntegrations();
	return json(result);
});
