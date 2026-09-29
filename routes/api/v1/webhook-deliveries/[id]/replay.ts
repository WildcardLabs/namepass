import {
	integrationRoute,
	segment,
} from "../../../../../server/integrations/http";
import { replayDelivery } from "../../../../../server/integrations/webhooks";
export default integrationRoute({
	POST: {
		scope: "webhooks:manage",
		idempotent: true,
		run: (c) => replayDelivery(c, segment(c.request, 2)),
	},
});
