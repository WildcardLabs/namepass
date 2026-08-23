export function receiptPollDelay(attempt: number): "5s" | "15s" | "30s" {
	if (attempt < 24) return "5s";
	if (attempt < 56) return "15s";
	return "30s";
}
