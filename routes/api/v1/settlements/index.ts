import { integrationRoute } from "../../../../server/integrations/http";
import { listResources } from "../../../../server/integrations/reads";
export default integrationRoute({
	GET: {
		scope: "read",
		run: async (c) => ({
			body: await listResources(c.partner.id, "settlement", c.search),
		}),
	},
});
