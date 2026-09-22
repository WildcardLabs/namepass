import { githubLogin } from "../../../server/monitoring-auth";
import { handler } from "../../../server/http";
export default handler("GET", async (request) => githubLogin(request));
