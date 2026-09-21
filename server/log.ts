type LogFields = {
	requestId?: string;
	flowId?: string;
	chainId?: number | string;
	step?: string;
	errorCode?: string;
	eventId?: string;
	blockNumber?: number;
	payloadHash?: string;
	receivedAt?: string;
	retryCount?: number;
};

/** Log only stable operational fields. Do not pass secrets, raw payloads, or signed transactions. */
export function logOperation(event: string, fields: LogFields = {}): void {
	console.info(serializedLog(event, fields));
}

/** Emit a structured warning without adding sensitive transaction data. */
export function logWarning(event: string, fields: LogFields = {}): void {
	console.warn(serializedLog(event, fields));
}

function serializedLog(event: string, fields: LogFields): string {
	return JSON.stringify({
		event,
		environment: process.env.DEPLOYMENT_ENVIRONMENT ?? "unknown",
		requestId: fields.requestId ?? null,
		flowId: fields.flowId ?? null,
		chainId: fields.chainId ?? null,
		step: fields.step ?? null,
		errorCode: fields.errorCode ?? null,
		eventId: fields.eventId ?? null,
		blockNumber: fields.blockNumber ?? null,
		payloadHash: fields.payloadHash ?? null,
		receivedAt: fields.receivedAt ?? null,
		retryCount: fields.retryCount ?? null,
	});
}
