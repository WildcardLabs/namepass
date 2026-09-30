import { sql } from "drizzle-orm";
import { jsonValue, type Executor } from "./store";

export async function enqueue(
	db: Executor,
	key: string,
	kind: string,
	input: unknown,
): Promise<void> {
	await db.execute(sql`insert into integration_jobs(key,kind,input) values(${key},${kind},${jsonValue(input)})
    on conflict(key) do update set input=excluded.input,
    status=case when integration_jobs.status='running' then 'running' else 'pending' end,next_at=now(),updated_at=now()`);
}
