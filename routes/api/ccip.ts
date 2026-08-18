import { ccipRespond, corsPreflight } from "../../server/ccip";
import { ApiError, readObject, requiredString } from "../../server/http";

/**
 * ERC-3668 gateway, POST form. A resolver `gatewayUrl` without a `{data}`
 * placeholder makes the client POST `{ data, sender }` here. This is the form to
 * configure for `namepass.eth`.
 */
export default {
	async fetch(request: Request): Promise<Response> {
		if (request.method === "OPTIONS") return corsPreflight();
		if (request.method !== "POST") {
			return ccipRespond(request, () => {
				throw new ApiError(405, "method_not_allowed", "The gateway accepts POST or GET.");
			});
		}
		return ccipRespond(request, async (req) => {
			const body = await readObject(req, ["data", "sender"]);
			return requiredString(body, "data", 1024);
		});
	},
};
