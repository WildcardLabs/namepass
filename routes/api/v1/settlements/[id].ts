import {
	integrationRoute,
	segment,
} from "../../../../server/integrations/http";
import { getResource } from "../../../../server/integrations/reads";
export default integrationRoute({
	GET: {
		scope: "read",
		run: async (c) => ({
			body: await getResource(c.partner.id, "settlement", segment(c.request)),
		}),
	},
});
