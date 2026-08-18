import { ccipRespond, corsPreflight } from "../../../../server/ccip";
import { ApiError, pathSegment } from "../../../../server/http";

/**
 * ERC-3668 gateway, GET form. A resolver `gatewayUrl` that contains `{sender}`
 * and `{data}` in the path makes the client GET them as path segments. The label
 * bytes are the last segment.
 */
export default {
	async fetch(request: Request): Promise<Response> {
		if (request.method === "OPTIONS") return corsPreflight();
		if (request.method !== "GET") {
			return ccipRespond(request, () => {
				throw new ApiError(405, "method_not_allowed", "The gateway accepts POST or GET.");
			});
		}
		return ccipRespond(request, (req) => pathSegment(req));
	},
};
