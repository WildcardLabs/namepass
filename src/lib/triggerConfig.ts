import { PUBLIC_CHAINS } from "./chains";

export interface PublicConfigRead {
	relayerAddress?: string | null;
	relayerAddresses?: string[];
	chains: Array<{ chainId: number; minimumTriggerAmount: string }>;
}

let minimumTriggerByChain: ReadonlyMap<string, bigint> | undefined;

/** Store only a complete public configuration. A partial response cannot enable a trigger. */
export function setPublicConfig(config: PublicConfigRead): void {
	const values = new Map<string, bigint>();
	for (const chain of config.chains) {
		if (!Number.isSafeInteger(chain.chainId) || !/^\d+$/.test(chain.minimumTriggerAmount)) {
			throw new Error("The public chain configuration is invalid.");
		}
		const id = String(chain.chainId);
		if (values.has(id)) throw new Error("The public chain configuration has duplicate chains.");
		values.set(id, BigInt(chain.minimumTriggerAmount));
	}
	for (const chain of PUBLIC_CHAINS) {
		if (!values.has(String(chain.chainId))) {
			throw new Error("The public chain configuration is incomplete.");
		}
	}
	minimumTriggerByChain = values;
}

export function minTrigger(chainId: string): bigint | undefined {
	return minimumTriggerByChain?.get(chainId);
}
