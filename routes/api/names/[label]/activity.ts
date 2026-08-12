import { activityCursor, activityPageInput, handler, json, pathSegment } from "../../../../server/http";
import { nameActivity } from "../../../../server/names";

export default handler("GET", async (request) => {
	const { limit, cursor } = activityPageInput(request);
	const result = await nameActivity(pathSegment(request, "activity"), limit, cursor);
	return json({ ...result, nextCursor: result.nextCursor ? activityCursor(result.nextCursor) : null });
});
