import { integrationRoute } from "../../../server/integrations/http";
import { quote } from "../../../server/integrations/quotes";
export default integrationRoute({
	POST: { scope: "read", expensive: true, run: quote },
});
