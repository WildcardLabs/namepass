import {
	integrationRoute,
	segment,
} from "../../../../server/integrations/http";
import { snapshotPage } from "../../../../server/integrations/reads";
export default integrationRoute({
	GET: {
		scope: "read",
		run: async (c) => ({
			body: await snapshotPage(c.partner.id, segment(c.request), c.search),
		}),
	},
});
