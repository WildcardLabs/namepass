import { handler, json, pathSegment } from "../../../server/http";
import { publicFlow } from "../../../server/reads";

export default handler("GET", async (request) => json(await publicFlow(pathSegment(request))));
