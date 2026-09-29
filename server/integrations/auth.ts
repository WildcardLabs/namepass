import { sql } from "drizzle-orm";
import { database } from "../db/client";
import { ApiError } from "../http";
import { keyDigest } from "./crypto";
import { query } from "./store";
import { ACTIVE_ENVIRONMENT } from "../../src/lib/chains";
import { DEPLOYMENT_ID, type Scope } from "./config";

export interface Partner {
	id: string;
	keyId: string;
	scopes: Scope[];
	readRate: number;
	writeRate: number;
}
export async function authenticate(
	request: Request,
	scope: Scope,
): Promise<Partner> {
	const token = request.headers
		.get("authorization")
		?.match(
			new RegExp(
				`^Bearer (np_${ACTIVE_ENVIRONMENT === "mainnet" ? "live" : "test"}_[a-f0-9]{16}_[A-Za-z0-9_-]{43})$`,
			),
		)?.[1];
	if (!token)
		throw new ApiError(
			401,
			"invalid_api_key",
			"A valid integration API key is required.",
		);
	const [row] = await query<{
		id: string;
		key_id: string;
		scopes: Scope[];
		read_rate: number;
		write_rate: number;
	}>(sql`
    select p.id,k.id as key_id,k.scopes,p.read_rate,p.write_rate
    from integration_keys k join integration_partners p on p.id=k.partner_id
    where k.digest=${keyDigest(token)} and k.revoked_at is null and p.enabled and exists(select 1 from integration_publication where id=1 and (deployment_id is null or deployment_id=${DEPLOYMENT_ID}))`);
	if (!row)
		throw new ApiError(
			401,
			"invalid_api_key",
			"A valid integration API key is required.",
		);
	if (!row.scopes.includes(scope))
		throw new ApiError(
			403,
			"insufficient_scope",
			"The API key does not have the required scope.",
			{ scope },
		);
	return {
		id: row.id,
		keyId: row.key_id,
		scopes: row.scopes,
		readRate: row.read_rate,
		writeRate: row.write_rate,
	};
}

/** Database token bucket: one atomic update across all function instances. */
export async function takeQuota(
	partner: Partner,
	bucket: "read" | "write" | "expensive",
): Promise<number | null> {
	const rate =
		bucket === "read"
			? partner.readRate
			: bucket === "write"
				? partner.writeRate / 60
				: 10 / 60;
	const capacity =
		bucket === "read"
			? partner.readRate * 2
			: bucket === "write"
				? partner.writeRate
				: 10;
	return database().transaction(async (tx) => {
		await tx.execute(
			sql`insert into integration_quotas(partner_id,bucket,tokens) values(${partner.id},${bucket},${capacity}) on conflict do nothing`,
		);
		const [state] = await query<{ available: string }>(
			sql`select least(${capacity},tokens+
      greatest(0,extract(epoch from clock_timestamp()-updated_at))*${rate})::text as available
      from integration_quotas where partner_id=${partner.id} and bucket=${bucket} for update`,
			tx,
		);
		const available = Number(state.available);
		await tx.execute(sql`update integration_quotas set tokens=${Math.max(0, available - (available >= 1 ? 1 : 0))},updated_at=clock_timestamp()
      where partner_id=${partner.id} and bucket=${bucket}`);
		return available >= 1
			? null
			: Math.max(1, Math.ceil((1 - available) / rate));
	});
}
