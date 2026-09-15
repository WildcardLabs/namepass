import { handler, json } from "../../../server/http";
import { monitoringGas } from "../../../server/monitoring-gas";
import { requireMonitoringSession } from "../../../server/monitoring-auth";
export default handler("GET", async (request) => {
  requireMonitoringSession(request);
  return json(await monitoringGas(), 200, {
    "cache-control": "private, no-store",
  });
});
