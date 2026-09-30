import { publicApi } from "../../../server/integrations/public";
import { quoteResponse } from "../../../server/integrations/quotes";
export default publicApi("POST", quoteResponse);
