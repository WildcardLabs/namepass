import { integrationRoute } from "../../../../server/integrations/http";
import { listResources } from "../../../../server/integrations/reads";
import { reportTransfer } from "../../../../server/integrations/commands";
export default integrationRoute({
	GET: {
		scope: "read",
		run: async (c) => ({
			body: await listResources(c.partner.id, "transfer", c.search),
		}),
	},
	POST: { scope: "transfers:write", idempotent: true, run: reportTransfer },
});
