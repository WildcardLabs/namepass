import { integrationRoute } from "../../../../server/integrations/http";
import { listWatches } from "../../../../server/integrations/resources";
export default integrationRoute({ GET: { scope: "read", run: listWatches } });
