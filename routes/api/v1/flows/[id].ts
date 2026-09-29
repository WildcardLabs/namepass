import {
	integrationRoute,
	segment,
} from "../../../../server/integrations/http";
import { flowResource } from "../../../../server/integrations/resources";
export default integrationRoute({
	GET: {
		scope: "read",
		run: async (c) => ({
			body: await flowResource(c.partner.id, segment(c.request)),
		}),
	},
});
