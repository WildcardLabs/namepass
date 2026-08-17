import { ApiError, handler, json, readObject, requiredString } from "../../../server/http";
import { triggerFlow } from "../../../server/trigger";

export default handler("POST", async (request) => {
	const body = await readObject(request, ["name", "chainId"]);
	const chainId = body.chainId;
	if (!Number.isSafeInteger(chainId) || Number(chainId) < 1) {
		throw new ApiError(400, "invalid_chain_id", "chainId must be a positive integer.");
	}
	const result = await triggerFlow(requiredString(body, "name", 512), Number(chainId));
	return json({ flowId: result.flowId, status: result.status }, result.httpStatus);
});
