import { handler, json } from "../../../server/http";
import { monitoringSession } from "../../../server/monitoring-auth";
export default handler("GET", async (request) => {
 const user = monitoringSession(request);
 return json({ authenticated: !!user, user }, 200, { "cache-control": "private, no-store" });
});
