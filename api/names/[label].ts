import { handler, json, pathSegment } from "../../server/http";
import { publicName } from "../../server/names";

export default handler("GET", async (request) => json(await publicName(pathSegment(request))));
