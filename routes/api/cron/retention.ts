import { requireCronAuthorization } from "../../../server/cron";
import { handler, json } from "../../../server/http";
import { deleteExpiredPayloads } from "../../../server/operations";

export default handler("GET", async (request) => {
	requireCronAuthorization(request.headers.get("authorization"));
	await (await import("../../../server/integrations/retention")).retainIntegrations();
	return json({ deleted: await deleteExpiredPayloads() });
});
