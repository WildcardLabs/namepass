import { activityCursor, activityPageInput, handler, json } from "../../server/http";
import { activity } from "../../server/reads";

const LIVE_HEADERS = { "cache-control": "no-store, max-age=0" };

export default handler("GET", async (request) => {
	const { limit, cursor, page } = activityPageInput(request);
	const result = await activity(limit, cursor, page);
	return json({ ...result, nextCursor: result.nextCursor ? activityCursor(result.nextCursor) : null }, 200, LIVE_HEADERS);
});
