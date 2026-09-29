import {
	integrationRoute,
	segment,
} from "../../../../server/integrations/http";
import { depositResource } from "../../../../server/integrations/resources";
export default integrationRoute({
	GET: {
		scope: "read",
		run: async (c) => ({
			body: await depositResource(c.partner.id, segment(c.request)),
		}),
	},
});
