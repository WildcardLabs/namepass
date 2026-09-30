import { publicApi } from "../../../../../server/integrations/public";
import { historyResponse } from "../../../../../server/integrations/history";
export default publicApi("GET", historyResponse);
