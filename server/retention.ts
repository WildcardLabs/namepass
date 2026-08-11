export const RAW_PAYLOAD_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

export function rawPayloadExpiresAt(now = new Date()): Date {
	return new Date(now.getTime() + RAW_PAYLOAD_RETENTION_MS);
}
