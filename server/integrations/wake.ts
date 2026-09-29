import { sql } from "drizzle-orm";
import { start } from "workflow/api";
import { integrationPump } from "../../workflows/integrations";
import { enabled } from "./config";
import { query } from "./store";
import { database } from "../db/client";

export async function wakeIntegrations(): Promise<void> {
	if (!enabled() || process.env.NAMEPASS_MAINTENANCE === "1") return;
	await Promise.allSettled(
		(["publication", "evidence", "delivery"] as const).map(async (role) => {
			const token = crypto.randomUUID(),
				key = `dispatcher:${role}`;
			const rows =
				await query(sql`insert into integration_jobs(key,kind,input,status,lease_token,lease_until)
    values(${key},'dispatcher','{}','running',${token},now()+interval '90 seconds')
    on conflict(key) do update set status='running',lease_token=excluded.lease_token,lease_until=excluded.lease_until
    where integration_jobs.status<>'running' or integration_jobs.lease_until<now() returning id`);
			if (!rows.length) return;
			try {
				const run = await start(integrationPump, [token, role]);
				await database().execute(
					sql`update integration_jobs set run_id=${run.runId} where key=${key} and lease_token=${token}`,
				);
			} catch (error) {
				await database().execute(
					sql`update integration_jobs set status='pending',lease_until=null where key=${key} and lease_token=${token}`,
				);
				throw error;
			}
		}),
	);
}
