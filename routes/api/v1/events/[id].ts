import {
	integrationRoute,
	segment,
} from "../../../../server/integrations/http";
import { getEvent } from "../../../../server/integrations/reads";
export default integrationRoute({
	GET: {
		scope: "read",
		run: async (c) => ({
			body: await getEvent(c.partner.id, segment(c.request)),
		}),
	},
});
