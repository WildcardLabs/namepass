import {
	integrationRoute,
	segment,
} from "../../../../../server/integrations/http";
import { testEndpoint } from "../../../../../server/integrations/webhooks";
export default integrationRoute({
	POST: {
		scope: "webhooks:manage",
		idempotent: true,
		run: (c) => testEndpoint(c, segment(c.request, 2), true),
	},
});
