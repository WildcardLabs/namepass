import { handler, json } from "../../../server/http";
import { publicConfig, PUBLIC_CACHE } from "../../../server/reads";

export default handler("GET", async () => json(publicConfig(), 200, PUBLIC_CACHE));
