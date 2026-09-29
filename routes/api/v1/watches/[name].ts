import {
	integrationRoute,
	segment,
} from "../../../../server/integrations/http";
import { changeWatch } from "../../../../server/integrations/resources";
export default integrationRoute({
	PUT: {
		scope: "names:write",
		idempotent: true,
		run: (c) => changeWatch(c, segment(c.request), true),
	},
	DELETE: {
		scope: "names:write",
		idempotent: true,
		run: (c) => changeWatch(c, segment(c.request), false),
	},
});
