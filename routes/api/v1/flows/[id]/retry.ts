import {
	integrationRoute,
	segment,
} from "../../../../../server/integrations/http";
import { retryFlow } from "../../../../../server/integrations/commands";
export default integrationRoute({
	POST: {
		scope: "flows:retry",
		idempotent: true,
		run: (c) => retryFlow(c, segment(c.request, 2)),
	},
});
