import { handler, json, pathSegment } from "../../../server/http";
import { publicFlow } from "../../../server/reads";

const LIVE_HEADERS = { "cache-control": "no-store, max-age=0" };

export default handler("GET", async (request) => json(await publicFlow(pathSegment(request)), 200, LIVE_HEADERS));
