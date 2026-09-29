import {
	integrationRoute,
	segment,
} from "../../../../server/integrations/http";
import {
	getEndpoint,
	editEndpoint,
} from "../../../../server/integrations/webhooks";
export default integrationRoute({
	GET: {
		scope: "webhooks:manage",
		run: (c) => getEndpoint(c, segment(c.request)),
	},
	PATCH: {
		scope: "webhooks:manage",
		idempotent: true,
		run: (c) => editEndpoint(c, segment(c.request)),
	},
	DELETE: {
		scope: "webhooks:manage",
		idempotent: true,
		run: (c) =>
			editEndpoint({ ...c, body: { enabled: false } }, segment(c.request)),
	},
});
