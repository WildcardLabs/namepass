import {
	integrationRoute,
	segment,
} from "../../../../server/integrations/http";
import { getResource } from "../../../../server/integrations/reads";
export default integrationRoute({
	GET: {
		scope: "read",
		run: async (c) => ({
			body: await getResource(c.partner.id, "transfer", segment(c.request)),
		}),
	},
});
