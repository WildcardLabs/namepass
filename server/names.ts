import { and, desc, eq, notInArray } from "drizzle-orm";

import { readEnsState, readNativeUsdcBalances, ensNamehash, labelHash } from "./chain";
import { database } from "./db/client";
import { flows, names, watchedAddresses } from "./db/schema";
import { minimumTriggerAmount } from "./config";
import { ApiError } from "./http";
import type { ActivityCursor } from "./http";
import { logOperation } from "./log";
import { publicBalances, publicFlowView, publicNameView, renewalActivity } from "./reads";
import { reconcileStoredRenewals } from "./goldsky";
import { SERVER_CHAINS } from "../src/lib/chains";
import { depositAddress, InvalidLabelError, normalizeLabel } from "../src/lib/namepass";

export function normalizedLabel(input: string): string {
	try {
		return normalizeLabel(input);
	} catch (error) {
		if (error instanceof InvalidLabelError) {
			throw new ApiError(400, "invalid_label", error.message, { problem: error.problem });
		}
		throw error;
	}
}

export async function activateName(input: string) {
	const normalized = normalizedLabel(input);
	const address = depositAddress(normalized).toLowerCase();
	let ens;
	try {
		ens = await readEnsState(normalized);
	} catch {
		logOperation("activation.ens_unavailable", { step: "ens_read", errorCode: "ens_unavailable" });
		throw new ApiError(503, "ens_unavailable", "ENS state is not available. Try again shortly.");
	}

	const db = database();
	const created = await db.transaction(async (tx) => {
		const [inserted] = await tx
			.insert(names)
			.values({
				normalizedLabel: normalized,
				displayName: `${normalized}.eth`,
				labelHash: labelHash(normalized),
				namehash: ensNamehash(normalized),
				depositAddress: address,
				currentExpiry: ens.expiry,
				renewableBy: ens.renewableBy,
				ensSyncedAt: new Date(),
				unscannedChainIds: SERVER_CHAINS.map((chain) => String(chain.chainId)),
			})
			.onConflictDoNothing()
			.returning();
		const row = inserted ?? (await tx.select().from(names).where(eq(names.normalizedLabel, normalized)))[0];
		if (!row) throw new Error("Activation insert did not return a name.");
		if (!inserted) {
			await tx
				.update(names)
				.set({ currentExpiry: ens.expiry, renewableBy: ens.renewableBy, ensSyncedAt: new Date() })
				.where(eq(names.id, row.id));
		}
		await tx
			.insert(watchedAddresses)
			.values({ value: address.toLowerCase() })
			.onConflictDoUpdate({ target: watchedAddresses.value, set: { updatedAt: new Date() } });
		return { row, inserted: Boolean(inserted) };
	});

	const balances = await readNativeUsdcBalances(address);
	const unknownChainIds = balances
		.filter((balance) => balance.amount === undefined)
		.map((balance) => String(balance.chainId));
	const positiveBalances = balances.filter(
		(balance): balance is Required<typeof balance> =>
			balance.amount !== undefined &&
			BigInt(balance.amount) >= minimumTriggerAmount(balance.chainId),
	);

	await db.transaction(async (tx) => {
		await tx
			.update(names)
			.set({ unscannedChainIds: unknownChainIds })
			.where(eq(names.id, created.row.id));
		for (const balance of positiveBalances) {
			await tx
				.insert(flows)
				.values({
					nameId: created.row.id,
					originChainId: String(balance.chainId),
					trigger: "recovery",
					status: "queued",
					holdReason: "balance_recovery",
					amountDetected: balance.amount,
				})
				.onConflictDoNothing();
		}
	});
	await reconcileStoredRenewals(address);

	const [name] = await db.select().from(names).where(eq(names.id, created.row.id));
	return { name: publicNameView(name), balances, activated: created.inserted };
}

export async function publicName(label: string) {
	const normalized = normalizedLabel(label);
	const db = database();
	const [name] = await db.select().from(names).where(eq(names.normalizedLabel, normalized));
	if (!name) throw new ApiError(404, "name_not_found", "This name is not activated.");
	const [activeFlows, balances] = await Promise.all([
		db
			.select()
			.from(flows)
			.where(and(eq(flows.nameId, name.id), notInArray(flows.status, ["settled", "cancelled", "failed"])))
			.orderBy(desc(flows.createdAt)),
		publicBalances(name.depositAddress),
	]);
	return { name: publicNameView(name), activeFlows: activeFlows.map((flow) => publicFlowView(flow)), balances };
}

export async function nameActivity(label: string, limit: number, cursor?: ActivityCursor) {
	const normalized = normalizedLabel(label);
	const db = database();
	const [name] = await db.select().from(names).where(eq(names.normalizedLabel, normalized));
	if (!name) throw new ApiError(404, "name_not_found", "This name is not activated.");
	const renewals = await renewalActivity(limit, cursor, name.id);
	const activityFlows = await db
		.select()
		.from(flows)
		.where(eq(flows.nameId, name.id))
		.orderBy(desc(flows.createdAt))
		.limit(limit);
	const balances = await publicBalances(name.depositAddress);
	return {
		name: publicNameView(name),
		renewals: renewals.items.map((item) => item.renewal),
		flows: activityFlows.map((flow) => publicFlowView(flow)),
		balances,
		nextCursor: renewals.nextCursor,
	};
}
