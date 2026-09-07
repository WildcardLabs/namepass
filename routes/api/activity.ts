import { activityCursor, activityPageInput, handler, json } from "../../server/http";
import { activity } from "../../server/reads";

export default handler("GET", async (request) => {
	const { limit, cursor, page } = activityPageInput(request);
	const result = await activity(limit, cursor, page);
	return json({ ...result, nextCursor: result.nextCursor ? activityCursor(result.nextCursor) : null });
});
