import { integrationRoute } from "../../../../server/integrations/http";
import { listEvents } from "../../../../server/integrations/reads";
export default integrationRoute({
	GET: {
		scope: "read",
		run: async (c) => ({ body: await listEvents(c.partner.id, c.search) }),
	},
});
