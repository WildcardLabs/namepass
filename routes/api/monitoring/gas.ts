import { handler, json } from "../../../server/http";
import { monitoringGas } from "../../../server/monitoring-gas";
export default handler("GET", async () =>
  json(await monitoringGas(), 200, {
    "cache-control": "public, s-maxage=60, max-age=0",
  }),
);
