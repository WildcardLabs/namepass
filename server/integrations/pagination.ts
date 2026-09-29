import { ApiError } from "../http";
import { decodeCursor, encodeCursor } from "./crypto";
import { pageSize } from "./validation";

export function managementPage(
	partner: string,
	kind: string,
	search: URLSearchParams,
) {
	for (const key of search.keys())
		if (!["limit", "cursor"].includes(key))
			throw new ApiError(
				400,
				"invalid_query",
				`Unknown query parameter: ${key}.`,
			);
	const cursor = search.get("cursor")
		? decodeCursor(search.get("cursor")!, partner, kind)
		: null;
	return {
		limit: pageSize(search),
		through: cursor?.position ?? String(Date.now()),
		after: cursor?.after ?? null,
	};
}
export function managementCursor(
	partner: string,
	kind: string,
	page: { through: string },
	after: string | null,
) {
	return after
		? encodeCursor({ partner, kind, position: page.through, after })
		: null;
}
