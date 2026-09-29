import { integrationsAdmin } from "../../../server/integrations/operator";
import { ApiError, json } from "../../../server/http";
export default {
	async fetch(request: Request) {
		try {
			return await integrationsAdmin(request);
		} catch (error) {
			const e =
				error instanceof ApiError
					? error
					: new ApiError(500, "internal_error", "The operator request failed.");
			return json({ error: { code: e.code, message: e.message } }, e.status, {
				"cache-control": "no-store",
			});
		}
	},
};
