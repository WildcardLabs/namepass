import { integrationRoute } from "../../../../server/integrations/http";
import {
	listEndpoints,
	createEndpoint,
} from "../../../../server/integrations/webhooks";
export default integrationRoute({
	GET: { scope: "webhooks:manage", run: listEndpoints },
	POST: { scope: "webhooks:manage", idempotent: true, run: createEndpoint },
});
