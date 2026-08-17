import { handler, json } from "../../server/http";
import { PUBLIC_CACHE, stats } from "../../server/reads";

export default handler("GET", async () => json(await stats(), 200, PUBLIC_CACHE));
