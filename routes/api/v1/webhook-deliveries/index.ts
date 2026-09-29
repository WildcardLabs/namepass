import { integrationRoute } from "../../../../server/integrations/http";
import { deliveries } from "../../../../server/integrations/webhooks";
export default integrationRoute({
	GET: { scope: "webhooks:manage", run: (c) => deliveries(c) },
});
