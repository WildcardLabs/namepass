# Bank integration examples

Node.js 22+ and PostgreSQL are required. Run from this repository after `npm ci`.
The examples never sign or send funds.

1. Use a separate application database. Apply `schema.sql` there.
2. Set `NAMEPASS_API` to the enabled deployment's `/api/v1` URL and
   `NAMEPASS_API_KEY` to a server-side partner credential. Never put keys in a browser.
3. Activate a name before funding it. Check `/config`, activation status and the full
   deposit address. Use `bank.mjs` to register an **already sent** transfer:
   `node examples/integration/bank.mjs alice.eth 84532 0x… bank-transfer-1001`.
4. Register a webhook endpoint. Set `NAMEPASS_WEBHOOK_SECRETS` to its signing secret;
   during rotation use a comma-separated list of current and previous secrets.
   Run `node examples/integration/receiver.mjs` behind your public HTTPS reverse proxy,
   routing `/namepass` to loopback port 8080. Verify the endpoint through the API.
5. Run `node examples/integration/reconcile.mjs` to bootstrap and catch up. Schedule
   it in your existing worker system; a nonzero exit should retry with backoff.
   The receiver and poller share transactional event deduplication and versioned state.

`DATABASE_URL` always points to **your application database**, never Namepass's.
Persist a bank transfer's reference and returned transfer ID before updating its UI.
Read `transfer.completed`, the deposit consumption and its finalized settlements;
execution failure or webhook retry must never trigger another bank transfer.

The receiver commits the inbox and resource update before acknowledging. Add your
business outbox in that transaction. The sample poller holds a local transaction
while bootstrapping; for large snapshots use staging tables and atomically switch
an active generation. Resource tombstones remain versioned records. Do not use a
poller's absent row as evidence of deletion; watches define visibility, not ownership.
