import { integrationRoute } from "../../../server/integrations/http";
import { publicIntegrationConfig } from "../../../server/integrations/config";
export default integrationRoute({
	GET: {
		scope: "read",
		run: async () => ({ body: publicIntegrationConfig() }),
	},
});
