import { ApiError, handler, json } from "../../server/http";
import { monitoring } from "../../server/monitoring";
export default handler("GET", async (request) => {
  const params = new URL(request.url).searchParams;
  const days = Number(params.get("days") ?? 30);
  const page = Number(params.get("page") ?? 1);
  const chainId = params.has("chain") ? Number(params.get("chain")) : undefined;
  const search = params.get("search") ?? "";
  const status = params.get("status") ?? "all";
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 100000 ||
    (chainId !== undefined && !Number.isSafeInteger(chainId)) ||
    search.length > 255 ||
    !["all", "attention", "active", "held", "unclaimed", "failed"].includes(
      status,
    )
  ) {
    throw new ApiError(400, "invalid_filter", "Invalid monitoring filter.");
  }
  if (![7, 30, 90].includes(days))
    throw new ApiError(400, "invalid_window", "Choose 7, 30, or 90 days.");
  return json(await monitoring(days, { page, chainId, search, status }), 200, {
    "cache-control": "public, s-maxage=30, max-age=0",
  });
});
