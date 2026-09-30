import {
	ACTIVE_ENVIRONMENT,
	HUB_CHAIN,
	SERVER_CHAINS,
} from "../../src/lib/chains";
import { minimumTriggerAmount } from "../config";
import { ApiError } from "../http";

export const API_VERSION = "2026-09-30";
export const DEPLOYMENT_ID = `${ACTIVE_ENVIRONMENT}:${HUB_CHAIN.chainId}:${HUB_CHAIN.factoryAddress!.toLowerCase()}`;
export function enabled(): boolean {
	return process.env.NAMEPASS_INTEGRATIONS_ENABLED === "1";
}
export function requireEnabled(): void {
	if (!enabled())
		throw new ApiError(
			503,
			"api_unavailable",
			"The public API is not enabled on this deployment.",
		);
}
export function fundingChains() {
	return SERVER_CHAINS.map((chain) => ({
		chainId: String(chain.chainId),
		name: chain.network,
		tokenAddress: chain.usdcAddress,
		minimumAmount: minimumTriggerAmount(chain.chainId).toString(),
	}));
}
