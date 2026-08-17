type LogFields = {
	requestId?: string;
	flowId?: string;
	chainId?: number | string;
	step?: string;
	errorCode?: string;
	eventId?: string;
	retryCount?: number;
};

/** Log only stable operational fields. Do not pass secrets, raw payloads, or signed transactions. */
export function logOperation(event: string, fields: LogFields = {}): void {
	console.info(JSON.stringify({
		event,
		environment: process.env.DEPLOYMENT_ENVIRONMENT ?? "unknown",
		requestId: fields.requestId ?? null,
		flowId: fields.flowId ?? null,
		chainId: fields.chainId ?? null,
		step: fields.step ?? null,
		errorCode: fields.errorCode ?? null,
		eventId: fields.eventId ?? null,
		retryCount: fields.retryCount ?? null,
	}));
}
