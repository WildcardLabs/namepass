import { handler, json, pageInput } from "../server/http";
import { leaderboard, PUBLIC_CACHE } from "../server/reads";

export default handler("GET", async (request) => {
	const { limit } = pageInput(request);
	return json(await leaderboard(limit), 200, PUBLIC_CACHE);
});
