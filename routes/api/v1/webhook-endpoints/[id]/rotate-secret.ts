import {
	integrationRoute,
	segment,
} from "../../../../../server/integrations/http";
import { rotateSecret } from "../../../../../server/integrations/webhooks";
export default integrationRoute({
	POST: {
		scope: "webhooks:manage",
		idempotent: true,
		run: (c) => rotateSecret(c, segment(c.request, 2)),
	},
});
