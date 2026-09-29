import { integrationRoute } from "../../../../server/integrations/http";
import { activate } from "../../../../server/integrations/commands";
export default integrationRoute({
	POST: {
		scope: "names:write",
		expensive: true,
		idempotent: true,
		run: (c) => activate(c),
	},
});
