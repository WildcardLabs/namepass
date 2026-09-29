import {
	integrationRoute,
	segment,
} from "../../../../../server/integrations/http";
import { addTransaction } from "../../../../../server/integrations/commands";
export default integrationRoute({
	POST: {
		scope: "transfers:write",
		idempotent: true,
		run: (c) => addTransaction(c, segment(c.request, 2)),
	},
});
