import {
	ACTIVE_ENVIRONMENT,
	HUB_CHAIN,
	SERVER_CHAINS,
} from "../../src/lib/chains";
import { minimumTriggerAmount } from "../config";
import { ApiError } from "../http";

export const API_VERSION = "2026-09-28";
export const DEPLOYMENT_ID = `${ACTIVE_ENVIRONMENT}:${HUB_CHAIN.chainId}:${HUB_CHAIN.factoryAddress!.toLowerCase()}`;
export const EVENT_RETENTION_DAYS = 90;
export const EVENT_TYPES = [
	...["name", "deposit", "flow", "balance"].flatMap((kind) => [
		`${kind}.updated`,
		`${kind}.deleted`,
		`${kind}.snapshot`,
	]),
	...["activation", "transfer", "consumption"].flatMap((kind) => [
		`${kind}.updated`,
		`${kind}.deleted`,
	]),
	"settlement.observed",
	"settlement.finalized",
	"settlement.invalidated",
	"settlement.deleted",
	"transaction.updated",
	"transaction.snapshot",
	"watch.created",
	"watch.removed",
	"flow.superseded",
	"evidence.updated",
	"coverage.updated",
];
export const SCOPES = [
	"read",
	"names:write",
	"transfers:write",
	"flows:retry",
	"webhooks:manage",
] as const;
export type Scope = (typeof SCOPES)[number];

export function enabled(): boolean {
	return process.env.NAMEPASS_INTEGRATIONS_ENABLED === "1";
}
export function requireEnabled(): void {
	if (!enabled())
		throw new ApiError(
			503,
			"integrations_unavailable",
			"The integration API is not enabled.",
		);
}
export function secret(key: string): string {
	const value = process.env[key];
	if (!value || value.length < 32)
		throw new ApiError(
			503,
			"integration_configuration",
			"Integration credentials are not configured.",
		);
	return value;
}
export function publicIntegrationConfig() {
	return {
		apiVersion: API_VERSION,
		environment: ACTIVE_ENVIRONMENT,
		deploymentId: DEPLOYMENT_ID,
		enabled: enabled(),
		eventTypes: EVENT_TYPES,
		eventRetentionDays: EVENT_RETENTION_DAYS,
		snapshotLifetimeSeconds: 86400,
		maxPageSize: 100,
		alias: {
			suffix: "namepass.eth",
			resolutionChainId: "1",
			verified:
				process.env.NAMEPASS_ALIAS_VERIFIED_DEPLOYMENT === DEPLOYMENT_ID,
		},
		chains: SERVER_CHAINS.map((chain) => ({
			chainId: String(chain.chainId),
			name: chain.network,
			factoryAddress: chain.factoryAddress,
			token: { address: chain.usdcAddress, symbol: "USDC", decimals: 6 },
			fundingModes: chain.key === "arc" ? ["erc20", "native"] : ["erc20"],
			nativeDecimals: chain.key === "arc" ? 18 : null,
			minimumTriggerAmount: minimumTriggerAmount(chain.chainId).toString(),
			hubChainId: String(HUB_CHAIN.chainId),
		})),
	};
}
