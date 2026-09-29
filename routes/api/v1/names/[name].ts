import {
	integrationRoute,
	segment,
} from "../../../../server/integrations/http";
import { nameResource } from "../../../../server/integrations/resources";
export default integrationRoute({
	GET: {
		scope: "read",
		run: async (c) => ({
			body: await nameResource(c.partner.id, segment(c.request)),
		}),
	},
});
