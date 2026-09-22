import { handler, json, pathSegment } from "../../../server/http";
import { publicName } from "../../../server/names";

const LIVE_HEADERS = { "cache-control": "no-store, max-age=0" };

export default handler("GET", async (request) => json(await publicName(pathSegment(request)), 200, LIVE_HEADERS));
