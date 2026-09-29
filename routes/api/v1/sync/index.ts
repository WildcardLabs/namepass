import { integrationRoute } from "../../../../server/integrations/http";
import { createSnapshot } from "../../../../server/integrations/reads";
export default integrationRoute({
	POST: {
		scope: "read",
		run: async (c) => ({
			status: 201,
			body: await createSnapshot(c.partner.id),
		}),
	},
});
