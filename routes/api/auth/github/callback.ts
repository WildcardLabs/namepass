import { githubCallback } from "../../../../server/monitoring-auth";
import { handler } from "../../../../server/http";
export default handler("GET", githubCallback);
