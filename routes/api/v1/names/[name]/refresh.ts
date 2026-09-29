import {
	integrationRoute,
	segment,
} from "../../../../../server/integrations/http";
import { activate } from "../../../../../server/integrations/commands";
export default integrationRoute({
	POST: {
		scope: "names:write",
		expensive: true,
		idempotent: true,
		run: (c) =>
			activate(
				{ ...c, body: { ...c.body, name: segment(c.request, 2) } },
				true,
			),
	},
});
