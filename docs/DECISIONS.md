# Decisions

A running, dated log of non-obvious architecture and product calls, and why they were made.
Append new entries at the top. Skip this for anything that's just "the obvious way to do it" —
this is for decisions someone could reasonably have made differently, where the *why* would
otherwise only live in a PR conversation or a chat transcript.

---

### 2026-09-21 — Acknowledge invalid Goldsky rows and keep safe replay evidence

An authenticated Goldsky row can fail application validation after Goldsky has delivered it. The
webhook returns `200` for that row so one invalid row does not stop the complete pipeline. It emits
a structured warning with the safe event ID, chain, block, validation error, receipt time, and a
SHA-256 payload hash. It does not log the raw payload or authorization header.

Configure a Vercel alert for `goldsky.rejected_payload`. After the parser or pipeline is fixed, use
a temporary, block-bounded Goldsky pipeline to replay the source row. Normal event IDs and database
constraints make the replay idempotent. Do not add a second event ledger or a dead-letter database
table. Those systems would add another writer and still would not replace the public chain source.

When a reorg deletes the only indexed ENS `NameRenewed` event for a name, clear
`names.current_expiry`. A later canonical event restores it. A null value is safer than displaying
an expiry that the canonical event set no longer supports.

### 2026-09-14 — Public shadcn monitoring with explicit evidence boundaries

Add `/monitoring` as a read-only dashboard. Use official shadcn registry components; do not build
new visual primitives. Canonical events own usage totals. Stored flow state owns the operational
queue. An overdue step is a review signal, not proof that a transaction failed. Step-entry time
must survive routine retries. A generic short Circle timeout was rejected because standard L2
finality is much slower than Arc finality.

Keep provider health and alert delivery explicitly unverified until their evidence is connected.
A quiet filtered event feed cannot prove an indexer outage. Relayer gas reads run only after an
explicit button press and use a short cache; the removed scheduled health poll stays removed.
The dashboard does not sum flow amounts as wallet balances or infer gas runway from arbitrary
thresholds. No new event ledger, queue, migration, or service is added. Embedded PostgreSQL is a
test dependency only. See `docs/MONITORING.md` for metric definitions and remaining provider checks.
### 2026-09-10 — Separate queue waits from receipt waits

The stress test exposed avoidable delay in the single-sender transaction queue. Active workflows
queried receipts before checking whether a prepared intent could broadcast. A queued transaction
also consumed the receipt backoff, so a long queue made later queue checks less frequent. The
inspected Arc flow spent about 14 minutes between claim preparation and broadcast. Its 51 claim
poll steps spent about 311 seconds executing. These measurements do not isolate each RPC call or
prove how much of the total delay this change will remove.

Keep the nonce queue and transaction safety rules from PRs 57–59. A fresh intent now checks its
queue position in Postgres every five seconds without chain RPC calls. Queue waits reset the
receipt poll counter. The active workflow broadcasts the same stored bytes when the intent reaches
the head. Prepared replacements and uncertain histories keep receipt lookup first. This preserves
the chance to observe an older mined attempt before another broadcast.

Do not shorten the recovery cron to drive active queues. The existing workflow already advances
eligible intents through `replaceStaleTransaction`. Recovery is a fallback. Do not add sender keys,
skip unresolved nonces, broadcast later nonces, or create cancellation transactions for this fix.
Exact CCTP identity, origin-wallet locks, late-deposit absorption, and versioned balance scans remain
unchanged. More frequent queue checks use more Workflow steps and database reads during a backlog.
They stop when the flow stops; there is no new idle poller. Measure queue delay and service usage
in a controlled stable-testnet run before claiming a throughput improvement.

See `docs/STRESS_TEST_2026-09-10.md` for evidence, prior failure modes, and release checks.

### 2026-09-07 — Reconcile late deposits with exact origin-block evidence

A deposit webhook can arrive while an earlier flow's origin transaction is finishing. The earlier
transaction spends the wallet's full live balance, so it can consume that deposit even when the
deposit was not known when the flow started. Creating a second flow for the late webhook leaves a
ghost that has historical deposit evidence but no balance to spend. Amount matching cannot repair
this safely because separate valid payments can have the same value.

Each confirmed origin execution now stores its receipt block. The origin-receipt writer and deposit
webhook take the same transaction-scoped lock for one name and origin chain. A deposit is absorbed
only when a later exact origin receipt reports zero remaining wallet balance. The webhook records
the deposit contribution but does not create a second flow. A workflow that was created before the
receipt became visible repeats the same live-balance check before signing and cancels that row with
`absorbed_by_prior_flow`. It also queues a block-pinned balance scan so a false or lagging RPC read
cannot suppress real funds. This reason is canonical reconciliation state, not a failed renewal.

Post-burn CCTP flows still release the origin wallet. Several attestation or claim flows can run for
the same name and chain while a new pre-origin flow spends a later balance. Only pre-origin stages
participate in the wallet-owner uniqueness rule.

Balance recovery now uses a versioned request for each name and chain. A deposit advances the
request and records the event block as a watermark. A scan clears only the version it read and only
after its block-pinned snapshot reaches that watermark. A scan that started before a deposit cannot
erase the newer request. The legacy `unscanned_chain_ids` array remains a public-read mirror, not
the recovery queue.

### 2026-09-05 — Repair the historical split evidence in the guarded migration

The stable testnet database contains one old race with two rows for one Circle nonce. The automatic
row owns the deposit, confirmed origin and claim transaction intents, and canonical renewal. The
external row owns the exact `DepositProcessed` event from that confirmed origin transaction. A
manual database edit would bypass the release record and would be difficult to reproduce.

Migration `0007` repairs this shape atomically. It accepts exactly two rows with the known terminal
states. It requires matching name, chain, amount, remainder, Circle message, and attestation. It
also verifies the deposit event, the origin intent and event transaction, the claim intent and
renewal transaction, and the exact preceding `CCTPClaimed` event. Circle and renewal accounting
must agree. The migration moves the origin evidence to the settled row and records the cancelled
duplicate in `flow_transitions`. It aborts for all other split shapes. The operator must confirm
that a retained Workflow run is complete before the migration starts.

### 2026-09-04 — Use exact event identity and one relayer nonce queue

An origin transaction hash is not a flow identity. One permissionless transaction can contain more
than one valid `renew` call. Each `DepositProcessed` event now identifies one origin execution. The
flow also stores the zero-based Circle message index for that transaction. The final CCTP identity
is the origin chain and the Circle nonce. Amount, name, chain, and transaction hash are validation
facts only.

A destination settlement can arrive before Iris gives the source flow its final nonce. In that
case, Goldsky creates a bare external settlement row. When the source flow gets the same nonce, the
server moves the settlement evidence to the source flow and cancels the bare row. It does not cancel
the evidence-rich source flow. A settlement reorg can then resume that source flow with its stored
message. On Ethereum, log order binds each `CCTPClaimed`, ENS `NameRenewed`, and `Renewed` event to
one helper call. A transaction hash cannot bind events in a batch.

The service uses one exclusive relayer EOA. Each chain has one database nonce queue for that sender.
RPC reads finish before the database transaction. The transaction then locks the flow and the one
nonce row, stores signed bytes, and advances the counter. Only the lowest unresolved nonce is
broadcast. The monitor warns after 30 seconds and uses same-nonce fee replacement after three
minutes.

The service does not create cancellation transactions for obsolete work. An already signed intent
stays durable until it gets a receipt. A terminal flow cannot be reopened by that receipt. This can
cost gas for a rare reverted call when another executor settled first. It avoids a second
cancellation state machine and makes a settlement reorg able to reuse the original business intent.

Receipt lookup uses only attempts for the intent's current nonce. Post-RPC writers lock the flow,
lock the intent, and verify that the receipt still belongs to that nonce. Broadcast writes compare
the status and hash that they read. A late writer therefore cannot replace newer canonical state.

A pre-sign validation result cannot cancel or hold a flow after an origin intent exists. A workflow
failure also cannot mark a flow failed while it has prepared, broadcast, or mined bytes. The monitor
must resolve those bytes first. If the exclusive account nonce advances without a receipt for any
stored attempt, the queue stops and alerts. It does not skip an unknown transaction.

Schema enforcement uses two release points. Release 1 applies migration `0006`, which adds nullable
identity fields and backfills only one-to-one origin event matches. The application then starts
writing exact identity. Release 2 pauses writers and applies migration `0007`. That migration runs a
guarded duplicate repair and adds the full CCTP nonce unique index. It aborts if a duplicate group
has conflicting source evidence or unresolved transaction work. It also aborts for a Workflow
owner unless the row matches the exact terminal split-evidence repair described above.

### 2026-08-26 — CCTP flows release the origin wallet after the burn

The old uniqueness rule allowed only one non-terminal flow for each name and origin chain. An
attested or unclaimed CCTP message therefore blocked a new deposit on the origin chain, although
the old USDC had already left that wallet.

The uniqueness rule now covers only the stages that can spend the origin wallet. A flow releases
the wallet after its burn receipt is verified. Later CCTP stages own only their exact Circle
message. A new origin flow can run while an older message waits for Iris or an Ethereum claim.
Goldsky marks only the affected name and chain for a balance scan when funds arrive during an
origin-wallet stage. Recovery does not read that balance until the stage releases the wallet.

Goldsky also records a permissionless origin burn as transaction evidence. The workflow verifies
the exact receipt and continues that Circle message instead of trying to burn an empty wallet.
Settlement events never replace the stored origin-wallet remainder with renewal pricing dust.

Pending relayer transactions use same-nonce fee replacement after five minutes. Every signed
attempt keeps the same destination, call data, value, gas limit, and nonce. Receipt checks search
all attempts because an older attempt can be mined after a replacement is signed.

### 2026-08-25 — Remove scheduled health polling with no alert consumer

The health cron called `eth_chainId` and `eth_getBalance` on four chains every five minutes. This
used 96 Edge RPC methods per hour and about 69,120 per 30-day month while the service was idle. Its
warning result returned `200`, its critical result returned `503`, and no configured consumer sent
either result to an operator. It did not block transactions or refill the relayer.

The scheduled health endpoint and its transaction-unit environment variables are removed. RPC
chain verification remains inside every transaction path that can spend relayer gas. Relayer gas
monitoring belongs in an external address-balance alert that has real notification delivery. With
no browser, deposit, due recovery, or active workflow, Namepass now makes zero chain RPC calls.

The same audit removed temporary raw rejected-payload logging. Invalid authenticated rows still
receive a safe `200` acknowledgement and a structured error event, but the service does not copy
their complete payload into Vercel logs. It also removed the inactive-name button's duplicate
activation scan. The manual trigger already verifies current ENS state and the selected-chain
balance, so rescanning ENS and all four balances first had no effect. The remaining RPC paths are
tied to a live read, deposit, bounded recovery item, or transaction decision.

### 2026-08-25 — ENS liveness comes from chain; held names recover without the UI

The name API stored expiry and renewability during activation. Later selected-name reads returned
that database snapshot. A name registered after it received funds therefore still appeared
unregistered. Its `name_not_renewable` flow also remained held until a person used the manual UI
action.

An explicit name lookup now reads the authoritative ENS renewers before it returns. The server
updates the database only as a cache for later activity reads. The selected-name view repeats this
read when it opens and when browser focus returns. It does not call chain RPC from the browser.

The recovery cron now rechecks held `name_not_renewable` flows on a five-minute backoff. A fresh ENS
read updates the cached name state. When the name becomes renewable, the cron queues and starts the
same held flow. This keeps renewal automation independent of the UI and bounds chain reads to ten
due held flows per cron run.

When an explicit lookup finds that the name is renewable, it also queues and starts matching held
flows before it returns. This avoids a response that says the name is registered while its pending
card still carries the old inactive hold. The cron remains the path that works without the UI.

### 2026-08-25 — Explorer polls indexed balances, and terminal empty-wallet rows do not poll RPC

The selected-name API read all four chain balances on every browser poll. One request used
`eth_chainId` and `balanceOf` on four chains. An idle tab therefore used up to 320 Edge RPC methods
in ten minutes. An active tab could use up to 1,200. This was not necessary for an explorer read.

Activation and bounded recovery now store one exact balance snapshot and block number per name and
chain. Public reads apply canonical Goldsky deposits and `DepositProcessed` events after that
block. The 4-second and 15-second activity polls use Neon only. Transaction preflight still reads
the live chain balance before it can move funds. A name open or focus event still reads ENS on
Sepolia because registration and renewability can change outside Namepass.

This does not restore the rejected running balance as workflow authority. The new table is a
block-pinned read-model anchor. Canonical events advance it. The chain remains authoritative for
activation, recovery, and transaction execution.

Six old cancelled flows also kept `empty_wallet` as their historical error after later repair flows
settled. Recovery selected those old rows every minute, read the now-empty wallet, did no work, and
logged `recovery.flow_started`. Terminal `empty_wallet` rows are no longer cron candidates. A new
Goldsky deposit or an explicit manual trigger supplies new evidence and can start work.

### 2026-08-23 — Deposit eligibility reads use the verified deposit block

Goldsky and the receipt check can observe a deposit before a different RPC replica serves that
state through an unpinned `latest` call. Four automatic flows therefore recorded `empty_wallet`
even though each wallet held 20 USDC. A finality sleep would hide some replica lag and would add an
unnecessary delay.

An indexed flow now reads the wallet balance at the canonical deposit block. An accumulated
automatic flow uses the latest canonical deposit block available when the flow was created. An
unavailable or impossible block result retries the workflow step. A safe stopped-flow retry uses
the original flow only when one canonical deposit equals the full live balance. This keeps exact
sender evidence. A balance with several deposits uses an unlinked recovery flow and states that no
single sender is authoritative.

### 2026-08-19 — Small deposits trigger from the accumulated chain balance

The Goldsky webhook used each transfer amount as the automatic trigger amount. Two separate $0.25
transfers therefore left a $0.50 wallet balance without a flow. The webhook now reads the live
single-chain wallet balance when a transfer is below the configured minimum. It starts one flow
when that balance reaches the minimum. The chain remains the balance authority. The service does
not add deposit amounts in the database.

An accumulated-balance flow leaves `deposit_event_id` empty. Linking the flow to the last transfer
would falsely attribute the full renewal to that sender and transaction. The individual transfers
remain in contribution history. The canonical `Renewed` event records the amount that the contract
processed.

### 2026-08-19 — Pending flows show confirmed transactions, not optimistic steps

An ongoing CCTP flow can wait for Circle for many minutes after its deposit and burn have already
succeeded. The pending card now shows those confirmed transactions with source-chain explorer
links. This gives verifiable progress without changing the workflow status copy.

The card adds the deposit when the flow has a linked Goldsky deposit event. It adds the Circle burn
only after the workflow has validated a successful origin receipt. A transaction hash can exist
before its receipt, so a submitted hash is not enough to display a step as complete. Claim and
renewal transactions remain in completed Activity after settlement because the pending card closes
when that final receipt succeeds.

### 2026-08-19 — A new balance is preparing before it is stuck

The selected-name API reads the deposit wallet balance and the workflow row from different sources.
The balance can appear one poll before Goldsky delivery creates the flow. The frontend previously
classified this normal gap as `not_detected`, enabled the manual trigger, and briefly said that the
renewal needed a retry. A live Ethereum Sepolia test reproduced the false warning immediately before
the renewal completed normally.

An eligible unmatched balance now gets a browser-local detection grace. The card says `preparing
renewal` and hides the manual trigger until the balance remains unmatched for two reads and at least
20 seconds. The two conditions prevent one fast re-render from consuming the grace. The time limit
prevents the 15-second idle poll from making a normal balance look failed after its first read.
Explicit backend flow failures stay immediately retryable. This is a presentation grace only. It
does not delay detection, workflow execution, or API polling.

### 2026-08-18 — Flow copy keeps chain meaning, and leaderboard rows preview transactions

The frontend keeps each active backend flow status. It does not compress the statuses into generic
signing, burning, attesting, and claiming states. User-facing copy also receives the origin chain.
For an Ethereum origin, `submitting_origin` and `waiting_origin` are renewal states. For Base,
Arbitrum, or Arc, they are Circle transfer states. The UI uses transfer copy for those chains and
never calls a direct Ethereum renewal a burn. After the origin receipt, the UI uses
`amount_processed`, which is the amount proved by that receipt.

Held and unclaimed flows are not active workflow execution. They now use the idle profile poll.
A failed cross-chain flow with a successful origin receipt stays visible even when the deposit
address balance is zero. The card states that the transfer needs repair. This prevents moved funds
from disappearing from the profile.

The Leaderboard accordion previews the three latest completed renewal transactions. It does not
duplicate the name profile, QR code, or deposit address. The button opens the complete profile and
activity history. A name must have at least one completed renewal before it enters the ranking.
The server filters before the result limit, and the browser checks the same rule. The ranking also
keeps the exact label list from the latest leaderboard API response. Names loaded by another
screen cannot leak into it through the shared record cache.

### 2026-08-18 — Origin transactions do not wait for separate deposit finality

An origin transaction can spend only USDC that exists in its chain execution state. A
reorganization that removes the deposit also prevents or removes the dependent origin transaction.
Waiting for the deposit to finalize before submission adds delay without adding a separate safety
property. Both workflows now validate the mined receipt and exact transfer, then submit the origin
transaction immediately.

For cross-chain flows, the required finality boundary comes after the burn. Circle applies the
configured finality threshold to that burn and Iris returns a complete attestation only after the
threshold is satisfied. Waiting before the burn made deposit finality and burn finality sequential
when only the second boundary controls cross-chain consumption.

### 2026-08-18 — Arc native deposits use transactions, and incomplete Iris rows are retryable

Arc USDC has two transfer representations. A call through the USDC system contract emits an ERC-20
`Transfer` event. A direct wallet payment sends USDC as native transaction value and emits no such
event. The Goldsky pipeline therefore keeps `arc_testnet.erc20_transfers` and adds
`arc_testnet.receipt_transactions`. The second source converts 18-decimal transaction value to the
6-decimal USDC contract amount. The workflow verifies a native deposit from the mined transaction
recipient and value instead of looking for a missing receipt log.

Circle Iris can return an incomplete message row before it includes the `message` field. Status is
therefore the first decision. A non-complete row is a normal polling result. The workflow validates
the message, attestation, and CCTP version only after Iris reports `complete`. Reversing this order
made a normal Arc pending response fail the workflow and delayed recovery by five minutes.

### 2026-08-18 — Transaction intents are resume boundaries, and Explorer separates state from history

A workflow restart must not return to deposit balance or ENS eligibility checks after it stores a
transaction intent. A successful transaction can empty the wallet and make the old preflight facts
false. Repeating those checks can then cancel a renewal that already settled on chain. Ethereum
and CCTP workflows now resume from the stored intent status: retry a mined revert, broadcast only
prepared bytes, or inspect the existing receipt. Recovery covers every resumable stage and also
reconciles cancelled rows with a non-reverted intent.

The Explorer now has two explicit sources. Live workflow rows come from `flows`; completed history
comes from canonical `Renewed` events. `GET /api/activity` returns both, without public caching, and
the browser consumes the renewal cursor when a person loads older activity. Per-name activity does
not return settled or cancelled flows, so a completed renewal cannot appear as a status card in the
name profile.

`expiryAtActivation` was removed from the production read model. Subtracting Namepass-delivered time
from the current ENS expiry invents a historical value when an owner or ENS migration also changed
the expiry. Settlement instead validates `NameRenewed` in the receipt, stores `flows.expiry_after`,
and updates the current name expiry. Goldsky remains the canonical event and reorg source.

### 2026-08-18 — CCIP-Read resolution lazily enrols labels for tracking

`namepass.eth` uses a wildcard resolver (ENSIP-10) that answers an `addr` query with ERC-3668
`OffchainLookup`. The client calls the gateway at `routes/api/ccip.ts`, which registers the label
through the existing `activateName` path and returns `abi.encode(true)`. The resolver then
computes the deposit address itself from the same label bytes. So a name starts being watched the
first time anyone resolves it, and a funder needs no separate activation step.

The gateway watches the address the resolver returns, so it must derive from the identical bytes.
The resolver derives from the raw label bytes in the ENS name and cannot run ENSIP-15. The gateway
therefore registers a label only when the bytes are already canonical (`normalizeLabel(raw) ===
raw`) and refuses anything else. This keeps the watched address and the returned address identical
and stops a non-normalized label from ever resolving to a fundable address.

The gateway fails closed and uses the HTTP status as the ERC-3668 retry signal. A refused label is
a `4xx`, so the read gives up. A transient failure, such as an unavailable ENS RPC, keeps its
`5xx`, so the read may retry. The gateway returns `200` with `true` only after the watched address
is persisted, which is the case the resolver's `RegistrationFailed` guard checks. Registration
writes the watched address before the cross-chain balance scan, so a scan failure still returns
`true` and the recovery cron finishes the scan.

The gateway is a public, unauthenticated write path, the same class as `/api/names/activate`. It
needs a Vercel Firewall rate limit before stable-testnet funding. See `docs/RUNBOOK.md`.

### 2026-08-17 — Circle Iris supplies the final CCTP v2 nonce

**Updated on 2026-09-04:** A permissionless transaction can contain several Namepass calls. The
workflow now selects the `MessageSent` event in the exact `DepositProcessed` call segment and stores
its zero-based message index. The final nonce still comes from Iris.

The CCTP v2 `MessageSent` event on the origin chain contains a zero nonce placeholder. Circle
assigns the final nonce off chain. Iris returns that nonce in the final message. Therefore, Goldsky
does not index Circle `MessageSent` events for Namepass.

The workflow verifies the selected `MessageSent` event in the origin transaction. It verifies the
route, amount, wallet, label, and requested finality. It then requests the selected message index
from Iris by source domain and origin transaction hash. The workflow verifies the final route and
stores the final message, nonce, and attestation before it submits the claim.

Goldsky indexes Namepass contract events. It indexes an ENS `NameRenewed` event only when it has the
Namepass referrer from the shared deployment registry. This rule prevents unrelated Circle and ENS
traffic from entering the application database. A referrer change must update the registry and the
pipeline in the same release.

The workflow records the origin transaction for renewals that it runs. A permissionless external
CCTP renewal can show the claim and renewal transactions, but it can lack the origin transaction.
Do not infer that transaction from labels, amounts, or event order. Add a separate Iris
reconciliation method only when Circle supplies a safe lookup for this case.

### 2026-08-12 — Nitro owns Vercel routing, and recovery verifies stale Workflow owners

Nitro emits the Vercel API routes and the SPA fallback. A root `api/` directory made Vercel build
the same Nitro function twice. A manual catch-all rewrite then ran before the generated API routes
and sent `/api/*` requests to `index.html`. Backend routes now live only in `routes/api/`, and
`vercel.json` contains only cron configuration. Nitro owns the route order.

A stale `workflow_run_id` is not proof that a Workflow run is dead. Clearing it by age alone can
start a second run for the same money movement. Recovery can select a stale owner, but the starter
uses Vercel Workflow `getRun()` first. It keeps pending and running runs. It replaces
only a missing or terminal run.

The initial Vercel Firewall limits are 10 activation requests and 20 trigger requests per minute
for one source IP. The live per-name read limit is 120 requests per minute for one source IP. An
active name polls 15 times per minute, so the read limit gives eight times the required capacity.
These endpoints make several RPC calls. The limits control provider cost and can change after
measured legitimate traffic.

### 2026-08-11 — Initial production scope closes the remaining backend questions

The first production version now has decisions for chain scope, relayer funding, public sender
identity, raw-event retention, unclaimed-flow UX, and provider plans. These decisions complete the
backend architecture. Provider support still needs verification during deployment.

**Initial mainnet is Ethereum, Base, and Arbitrum. Arc remains on testnet.** Circle currently lists
Arc Testnet, but not Arc mainnet, as a CCTP domain. Goldsky also lists Arc Testnet, but not Arc
mainnet. Mainnet launch must not wait for a chain whose required services do not exist. Arc can be
added after native USDC, CCTP v2 hooks, Goldsky datasets, deployed Namepass contracts, and a
low-value canary are all present.

**The treasury funds the production relayer manually.** The architecture does not require a
specific treasury wallet type. An automatic refill signer would add another key that can move
treasury funds. The first version does not need it. Per-chain balance alerts use a transaction unit
equal to twice the greater of the tested maximum gas cost and the observed seven-day 95th-percentile
cost. Warning, critical, and refill levels are 20, 5, and 50 units. The private runbook names the
primary and backup operators.

**Public activity shows raw addresses.** `deposits.sender_address` is `Funded by` and
`Renewed.executor` is `Processed by`. Namepass identifies its configured relayer, but it still
exposes the address in the detail view. ENS resolution was rejected for the first version because
it adds a network dependency and needs forward verification to prevent a misleading reverse name.
The UI does not infer an owner, supporter, or identity profile from an address.

**Raw Goldsky payloads remain for 30 days.** Normalized event fields, canonical state, domain rows,
and transaction evidence remain without a time limit. Goldsky can replay the raw public chain data,
so permanent duplicate storage has no launch benefit. A daily job clears only the expired payload.
It does not delete the event row.

**An unclaimed flow is visible and actionable.** The card says that the USDC left the origin chain,
is secured in a Circle message, and will retry when the name becomes renewable. It shows the amount,
origin transaction, Circle nonce, and latest retry. When ENS reports that the name is renewable, an
idempotent `Retry renewal` action resumes the same flow. It never starts another burn. Automatic
retry remains the normal path.

**Stable testnet uses Goldsky Starter; Scale is conditional at production.** The free Starter
allowance covers one continuously active small `namepass-testnet` pipeline, and that one pipeline
reads all four testnet chains. Scale is required only if `namepass-testnet` and `namepass-mainnet`
must run concurrently. This is a production decision, not a Phase 0 or stable-testnet requirement.
Initial production still uses Vercel Pro for the per-minute recovery cron and Neon Launch for the
small workload and seven-day restore window. Start with small compute sizes and scale only from
measured load. Check plan names and limits again before purchase.

### 2026-08-11 — Trigger floor, helper dust, and what happens when a balance read fails

Three items that were open are now decided. The third one found a hole between two mechanisms that
each looked complete.

**The trigger floor is $0.50 on a single chain, flat.** It was a ratio — `MAX_FEE_BPS = 1500n`, "the
gas allowance may be at most 15% of the balance" — which produced $0.666667 and was explicitly a
placeholder. Namepass fronts dollars of mainnet gas per flow and rebates ten cents, so the real
question was how much subsidy per renewal is acceptable, which no arithmetic on the allowance
answers.

The per-chain server configuration stays. $0.50 is the value every chain starts at, not a constant
that removes the setting. In the frontend it is `MIN_TRIGGER` in `src/lib/registry.ts` until the
Phase 6 cutover, after which the API supplies it and the constant goes away. Keeping the ratio and
retuning it to 2000 bps would also give $0.50 today; that was rejected because it lets the published
minimum move if the allowance ever changes, and the minimum is a figure the UI states to funders.

**Helper dust is the deployer's responsibility, handled contract-side, with no UI.** The open
version of this asked where withdrawn dust should go. It is rounding residue with no individual
owner — renewals buy whole seconds and the sub-second remainder stays in the helper. It is not a
funder's pending balance, and putting it in the schema or on a card would tell funders that
something of theirs is stuck. `DustWithdrawn` records the withdrawal. One operational consequence
survives: an "is the helper empty" check must use a threshold rather than zero, or it alerts
forever.

**A balance read fails soft — and that exposed a gap.** Activation reads four chains. A read can
fail. It must not fail the activation, and an unanswered chain must render as **unknown**, never as
zero and never as absent, because both state a fact the application does not have.

The gap is what happens next. Two mechanisms were supposed to cover a pre-activation transfer:
activation balance recovery, and the public manual trigger. Trace a failed read against them:

```
activation reads 4 chains → Arc RPC fails → no balance seen → no flow queued
recovery job looks for queued flows → finds none
recovery job does not scan deposit addresses → never looks again
```

The funds are invisible to the backend permanently, and the only recovery is a person noticing and
pressing the manual trigger. Activation balance recovery only recovers what it managed to read.

So `names` gains `unscanned_chain_ids`, and the recovery job gains one case: names whose activation
read is recorded as incomplete. **This is not the address sweep that was rejected.** The candidate
set is names already activated with a recorded failure, so it is bounded by activation volume and
empties itself, rather than polling thousands of addresses nobody funded.

**No operator dashboard.** An earlier draft specified one with five queues. It was dropped in favour
of what this document already has: the recovery cron performs the unsticking automatically, the
provider dashboards cover monitoring, and the alert list covers the exceptions. A custom UI for
queues that should be empty is speculative work before anything has launched. The correct output of
that analysis was not a dashboard — it was the missing recovery case above.

### 2026-08-11 — Goldsky detects, Neon records, and Vercel executes the production flow

The previous backend specification used Moralis streams, Supabase Postgres, Supabase Realtime, a
worker, and a reconciliation cron. None of it was built. The remaining implementation will use
Goldsky Turbo, Neon Postgres, and Vercel. The complete current design is in
`docs/ARCHITECTURE.md`.

The platform boundary is strict:

- **Goldsky Turbo detects chain events.** It reads the Neon watched-address table, filters native
  USDC transfers, decodes Namepass protocol events, and sends an authenticated webhook.
- **Neon Postgres records application state.** It stores names, canonical events, deposits, flows,
  transaction intents, and public read data.
- **Vercel Functions serve HTTP.** They validate requests, commit database transactions, and start
  workflows.
- **Vercel Workflow executes renewals.** It validates deposit receipts, sends origin transactions,
  polls Circle Iris for burn finality and attestation, sends Ethereum claims, and resumes after
  failures. The original separate deposit-finality wait was removed on 2026-08-18.
- **The chain remains authoritative.** A database row does not prove a balance, receipt, CCTP
  route, or ENS renewal.

This uses Goldsky's deposit-detection pattern, including a Postgres-backed dynamic table. However,
it makes one deliberate change to the example: the Turbo pipeline uses the webhook sink and does
not also write the same transfer to a Postgres sink. The webhook receiver upserts the event into
Neon before it returns `2xx`. Goldsky checkpoints its source and retries transient webhook failures
indefinitely. A second sink would add a second writer and a delivery-order race without adding a
new source of truth. See [Goldsky's deposit-detection guide](https://docs.goldsky.com/solutions/deposit-detection)
and [delivery guarantees](https://docs.goldsky.com/turbo-pipelines/delivery-guarantees).

The webhook is at-least-once. Duplicate events are normal. A stable Goldsky event ID and database
unique constraints make duplicate delivery safe. The pipeline also keeps `_gs_op`, so a reorg
delete can mark an event as orphaned before funds move.

The watched-address table creates an activation requirement. Goldsky cannot reverse a CREATE2
address to find its ENS label. The API must therefore normalize and activate a label before the
frontend shows its copy button or QR code. The activation transaction inserts both the name and
the lowercase address. It then checks the live USDC balance. This balance check recovers an address
that was funded before activation. It cannot reconstruct sender metadata that Goldsky never saw,
so the recovered deposit is marked as recovery data rather than invented history.

Neon replaces the Supabase-specific parts. The browser does not connect to Neon. Public reads go
through Vercel APIs. The frontend polls active flows instead of using Supabase Realtime or a new
WebSocket service. Vercel Functions use a pooled Neon connection. Migrations and Goldsky use direct
connections with separate roles. Pull-request previews use isolated Neon branches. The stable
Goldsky pipeline never targets a pull-request preview URL. See [Neon's connection guidance](https://neon.com/docs/connect/connection-pooling)
and [branching workflow guidance](https://neon.com/branching).

Vercel Workflow replaces a custom queue and worker. Each network or database operation is a
durable step. The workflow can sleep while Circle prepares an attestation. It can resume after a
deployment or crash. One small authenticated cron repairs work that was committed but not started.
The cron does not scan chains or maintain another balance ledger. See [Vercel Workflow](https://vercel.com/docs/workflow)
and [Vercel Functions for Vite](https://vercel.com/docs/frameworks/frontend/vite).

The flow uses the wallet's live native USDC balance. Deposit rows are contribution history. The
`DepositProcessed` event records the amount a renewal actually consumed. This removes the proposed
`deposit_allocations` and running-balance tables. It also avoids making database arithmetic compete
with the token contract.

Protocol events remain part of the Goldsky pipeline even though the workflow parses its own
receipts. The contracts are permissionless. A person can call `renew` or `completeCCTP` while the
backend is offline. Indexing `DepositProcessed`, `CCTPClaimed`, and `Renewed` makes this external
work visible and reconciles public history.

One `renew` call produces at most one CCTP message. The contract reads Circle's current burn limit
and processes one capped amount. It leaves a remainder at the same address. A settled workflow can
queue another flow when `DepositProcessed.remaining` is non-zero. The workflow does not need a
multi-message child system.

Rejected alternatives:

- Keep Moralis and Supabase beside the selected providers. This duplicates responsibilities.
- Use both the Goldsky Postgres sink and webhook for the same row. This creates two writers.
- Add Redis or a separate queue. Vercel Workflow already supplies durable execution.
- Keep an application balance aggregate. The native USDC contract already supplies the balance.
- Add WebSockets. The CCTP wait is measured in minutes on some chains, so short polling is enough.
- Point Goldsky at Vercel preview deployments. Those URLs and database branches are temporary.
- Enable Fast CCTP at launch. It adds fee and attestation-expiration policy before the Standard
  path is proven.

The tradeoff is provider dependence. Goldsky must deliver events, Neon must accept writes, and
Vercel must resume workflows. The mitigation is not another copy of each provider. It is strict
idempotency, canonical chain checks, stored signed transactions, permissionless contract entry
points, and tested recovery procedures.

### 2026-08-11 — `findExpiry` is authoritative for v1 names too; grace is `expired && renewable`

Premigrated names come back from `findExpiry` **62 days later** than v1's own registrar, and this
was first read as a bug and "fixed" by reading v1's `BaseRegistrar.nameExpires` instead. That was
wrong, and the reversal is worth recording because the wrong answer is the intuitive one.

ENS v2 shortens the grace period from 90 days to 28, and compensates with a one-time free 62-day
renewal applied to **every** v1 name automatically at the upgrade — no action by the owner (DAO
proposal 6.43). So the 62 days is real registration time, not registry bookkeeping, and from v2
launch `findExpiry` is the operative expiry for both populations:

```
v1 basis:  expiry + 90d grace
v2 basis:  (expiry + 62d) + 28d grace     ← same instant, and what holds at launch
```

We build against v2 launch, so `ETHRegistrar` and `ETHRenewerV1` are the authority. They answer
for both populations, which is exactly why they're the right pair — v1's `BaseRegistrar` is not
consulted at all, and neither is the 62-day offset.

**What made this confusing on testnet.** Sepolia today is mid-migration: the +62 days is recorded
in the registry, but v1 still governs, so `ETHRenewerV1.getRemainingGracePeriod` reports grace
against the *un-extended* expiry. On `farcaster` that read 73.8 days of grace while `findExpiry`
said 46 days of registration remaining — two clocks on one card, which is precisely how the UI
ended up saying "expires 26 Sept" above "lapsed 16 days ago". That state disappears at launch.

**So grace is derived, not fetched:** `expired && renewable`, using `findExpiry` for the first and
`isRenewable` for the second. It needs no window constant — past grace both renewers return false
(checked on `nouns`, released and false on both). `getRemainingGracePeriod` still supplies how
long is left, but only once `findExpiry` says the name has expired, so it can never contradict the
date on the card.

**Grace notice.** A name in grace gets a panel naming the deadline and the minimum worth sending.
That minimum is the larger of the catch-up cost — a renewal extends from the expiry, not from
today, so it must buy back what has already lapsed, at full rate since the discount tiers all need
years — and `minTrigger()`, below which a payment parks instead of moving. The sentence changes to
name whichever bound applies; quoting one while the other binds would be precise and useless.

### 2026-08-11 — Expiry and renewability read from ENS, and the simulated history slides to fit

The date on a name card was a seeded PRNG. It's now `findExpiry(label)` on ENS's registry, reached
the same way the oracle is — `ETH_REGISTRY()` off both renewers, which must agree, rather than a
pinned address. Renewability is `isRenewable(label)` on both renewers, true if either claims it,
matching how `_selectRenewer` picks.

**The interesting part is what to do with the simulated history underneath.** Those renewals were
generated to add up to the fake expiry, so making the expiry real leaves them contradicting it. The
options were to show the real expiry and let the runway disagree with it, to keep the fake expiry
and quarantine the real one somewhere else, or to slide the whole timeline so its end lands on the
real date. Sliding won: the figure a funder actually reads is then the chain's, and the seeded
renewals stay internally consistent behind it. Overwriting just the end was tried and produced "at
activation 2027 → now 2045" for a history that only added ten years. (The same trick was already in
the file for the hardcoded not-renewable name; this generalises it and deletes that hardcode.)

Two states that must not be conflated, and the type enforces it: `fetchNameState` returning `null`
means the read failed, while `{ expiry: null }` is the chain saying nobody has registered the name.
Showing "Not registered" for a slow RPC would be a lie about someone's name.

Also removed: `NOT_RENEWABLE = new Set(["ens.eth"])`. ENS's own answer replaces it — and on Sepolia
`ens.eth` is in fact renewable, via `ETHRenewerV1`, so the hardcode was wrong as well as fake.

**Not fixed, and worth flagging:** `pass` — the `<label>.namepass.eth` shown as "Send here · auto
renewal address" — is still string concatenation. `namepass.eth` exists on Sepolia but has no
resolver, so those subnames resolve to nothing while sitting above the real address in the UI.

### 2026-08-11 — Only what quotes a price waits on the oracle, and it waits as a skeleton

Gating whole pages on the oracle read was wrong, and visibly so: for ~220ms on every reload a
white card sat where the hero belongs, then swapped to the video hero while the document height
went 1007 → 3444px. It read as the page breaking, not loading.

The rule now is that a component waits only if it actually quotes a price. The hero is copy over
video and paints on the first frame; its one pricing dependency, the renewal ticker, mounts when
the rates land and its existing 0.2s slide-in absorbs the delay. The Simulator renders its own
section, heading, card and tabs immediately, with skeletons standing in for the two panels that
show numbers. The placeholder and the real body are both 916px, so nothing moves when the values
arrive.

**The wait says nothing.** An earlier pass had a "reading ENS's price oracle" panel explaining
where rates come from, plus a line under the Simulator linking the oracle contract. Both went:
at ~150ms the panel was a flash rather than information, and narrating the app's own network
activity is clutter on a page whose job is to answer "what does $27 buy". The provenance belongs
in the docs, not in the UI. A *failure* still gets words, because there's no cached price to
quietly carry on with.

Consequence worth knowing: `Simulator` is now a shell that picks between `SimulatorBody`, a
skeleton, and an error. The body has to stay a separate component — it prices inside a `useState`
initializer, so it must not mount at all before the rates exist.

### 2026-08-11 — Prices read from ENS's oracle at boot

`src/lib/pricing.ts` no longer contains a price. Base rates, discount tiers, the discount
denominator and the USDC conversion ratio are read from ENS's `StandardRentPriceOracle` when the
app loads (`oracle.ts`), and every pricing function throws until they arrive. This closes the
duplicate flagged the day before, below.

Three calls that could each have gone the other way:

**The oracle is discovered, not pinned.** `docs/DEPLOYMENTS.md` has its address and using it
would have been one constant instead of two. Rejected because the helper deliberately doesn't do
that — it reads `rentPriceOracle()` off the renewer it's about to call, on the grounds that
reading it from anywhere else is how the agreement between quote and charge stops being an
invariant. So the frontend pins the two *renewer* addresses and asks them. Those are addresses,
not prices, and they're the same class of constant as the USDC contracts in `tokens.ts`.

Consequence: the app can't select a renewer per label the way `_quote` does, because the price
table it draws is generic (3 / 4 / 5+ characters) and has no label to select with. It reads both
renewers' oracles and requires them to agree. Today they're the same contract. If they ever
diverge there is no single table to draw, and it fails rather than pricing half of ENS wrongly.

**Fetched once at boot, not per quote.** Calling `quote()` on the helper per keystroke would be
the most faithful thing possible and would make the Simulator unusable — that page's whole point
is that dragging a slider updates instantly. Reading the *parameters* once and inverting them
locally keeps every quote synchronous and costs one ~150ms read at load. The inversion is the only
part that's ours, and it's checked against the chain (below).

**No fallback table.** The tempting middle ground — ship the current values as a default and
refresh from the oracle in the background — was rejected outright. It reintroduces exactly the
failure being removed, just with a shorter window: a first paint quoting `$16.61` for a 3-year
tier that has since moved, to someone who then sends `$16.61`. Nothing is priced from memory, so
a failed read says so plainly instead.

The knock-on is that `registry.ts` can no longer build its seeded history at import — those
renewals are priced with the same `solve()` — so `initRegistry()` runs after the read lands.

> **Amended same day.** The first version of this gated *whole pages* on the read, which put a
> white card where the hero belongs for ~220ms on every reload, with the document height jumping
> 1007 → 3444px underneath it. See the entry above.

**What proves it:** `solve()` against the deployed helper's `quote(label, amount)`. Checked on
nine cases across 3, 4 and 5+ character names and every discount tier when this landed; all nine
matched to the second, including `quote("vitalik", 8000000) = 31535917`.

Not done, and worth knowing: the read isn't cached across page loads, and there's no error
boundary, so a component that somehow renders before `setRates()` throws rather than degrading.
In dev this shows up as a crash after editing `pricing.ts`, because HMR resets the module
singleton under mounted components; a reload fixes it.

### 2026-08-11 — Deposit addresses derived locally, not read from the chain

The app now shows the real deposit address for a name (`src/lib/namepass.ts`) instead of seeded
random hex. The derivation is reimplemented in TypeScript rather than fetched via
`predictWallet(string)` on an RPC.

Calling the contract would have been the obvious way and was rejected on two counts. The
derivation depends on nothing but the factory address and the label — no chain state, no block —
so an RPC round-trip buys no additional truth, only a spinner and a failure mode on the one
element in the UI that must never be blank or stale. And an address fetched over an RPC is only as
trustworthy as that RPC; deriving it locally means the bytes come from constants sitting in the
repo, reviewable, rather than from whatever a public endpoint returned.

What that costs is a duplicated derivation — the same shape of problem as the pricing constants
below, and pinned by the same things (`foundry.toml`'s compiler settings feed the creation-code
hash). It's bounded differently, though: the factory is immutable and already deployed, so unlike
the ENS rates there's nothing upstream that can move under it. It can only break if someone edits
a constant, which is why the file says so at length.

**What would catch it:** `cast call $FACTORY 'predictWallet(string)(address)' vitalik` against
`0x043c184003266644372bA5fA4946777b3f1cFC3D`. Checked against six labels on three chains when this
landed.

### 2026-08-11 — ENSIP-15 normalization added as a dependency rather than a regex

`@adraffy/ens-normalize` (~60 KB) went in as a real dependency, and the two entry points that used
`/^[a-z0-9-]{3,}$/` to validate a name now ask `labelProblem()` instead.

A regex was the cheaper option and is what the app had. It's wrong in both directions: it rejects
emoji and non-Latin names, which ENS genuinely supports, and it accepts things ENSIP-15 doesn't —
`ab--cd.eth` passed it, and would have been offered an "Activate now" button and a deposit
address. That address is derivable, fundable, and permanently unrenewable, because the factory
hashes the exact bytes it's given and there's no sweep. The contract's own comment hands
normalization to off-chain tooling for exactly this reason; leaving the gap open was the only
option not on the table.

Consequence worth knowing: normalization is the *last* word on validity, so the three-character
floor and the "no dots" rule live in `namepass.ts` now rather than in the components. The
Explorer's hardcoded "ENS names need at least three characters" is one of several answers it can
give, not a special case.

### 2026-08-10 — Testnet deployed; the frontend's pricing constants are now a duplicate

The contracts are live on Sepolia, Base Sepolia, Arbitrum Sepolia and Arc, and every path has run
on chain: both ENS renewers, all three CCTP origins, the executor payment, the accounting.
`docs/DEPLOYMENTS.md` has the addresses and the evidence.

That changes the status of something that was previously harmless. `src/lib/pricing.ts` hardcodes
the base rates and discount points; the helper reads them from the registrar's own oracle on every
quote. Both were derived from the same source and agree exactly today — verified against the live
oracle — but only one of them tracks ENS. If ENS reshapes the tiers, the chain follows and the UI
does not, and the UI is the half that makes promises to a funder.

Left as a duplicate rather than fixed, deliberately: reading the oracle at runtime means the
Simulator cannot price anything until a network round-trip lands, on a page whose whole point is
that dragging a slider updates instantly. The honest options are a build-time fetch that fails
loudly on drift, or a monitoring check comparing the two. Neither is built.

**What would catch it:** `getBaseRates()` and `getDiscountPoints()` on the oracle in
`docs/DEPLOYMENTS.md` versus `BASE_RATE_PER_CP` and `TIERS`. If they ever disagree, the frontend is
wrong and the contracts are right.

> **Resolved 2026-08-11.** The duplicate is gone — `pricing.ts` reads those same two getters at
> boot rather than holding a copy, so there is nothing left to drift. `BASE_RATE_PER_CP` and
> `TIERS` no longer exist. See the entry at the top; the reasoning about the Simulator's
> instant slider still holds and is why the read happens once at load rather than per quote.

A related note recorded while it is fresh: **CCTP attestation time is not uniform**. Arc attested
in ~30 seconds where Base took ~26 minutes, measured minutes apart on the same label. Settlement is
therefore not FIFO, and a worker that assumes one chain's timing will mis-handle the others. Full
figures in `docs/ARCHITECTURE.md`.

---

### 2026-08-08 — The hero corner seam was the video pull-back radius, not the masks

The hairline at the Explorer panel's corner survived an earlier attempt at it and was reported
again, now with the clue that fixed it: **it only shows below `md`.**

That clue points at `BottomLeftCard`, which flips from `right-4` to `md:left-6` at exactly that
breakpoint — the leaderboard card visibly jumps from right to left, so it looks like the cause. It
isn't. The same `md` boundary also switches `PageShell`'s video pull-back from `2.5rem` to `5rem`,
and *that* is the change that matters. Two unrelated things changing at one breakpoint is what made
this hard to place.

The pull-back exists to keep video out from behind the card's rounded clip, where the clip is
applied to both the video and the panel and `a - a^2` leaks up to a quarter of the video through
whatever is painted over it. The test for "is the pull-back big enough" was assumed to be
*is its radius larger than the card's*. That is the wrong test. `-inset-1` puts the video's corner
4px outside the card's, so the two arcs are neither concentric nor similar, and the overhang does
not scale with the breakpoint. Clearance is tightest at the **ends** of the card's arc, 0deg and
90deg — not the 45deg midpoint, which is where the eye goes and where the old values did pass.

Measured off the live DOM, with card radius r and overhang 4, the pull-back must satisfy
`(R-4)^2 + (R-r-4)^2 > R^2`:

| | card radius | pull-back | min clearance | at |
|---|---|---|---|---|
| below `md`, before | 24px | 40px | **−2.05px** | 0deg |
| `md`+, before | 48px | 80px | +0.99px | 0deg |
| below `md`, after | 24px | 64px | +5.97px | 0deg |
| `md`+, after | 48px | 96px | +5.98px | 0deg |

So the narrow breakpoint was 2px short and the wide one passed by under a pixel — luck, not
design, which is why `md`+ was bumped too rather than left alone. `4rem`/`6rem` clear by ~6px at
every angle. Both still sit entirely under the opaque panel (37.7px and 64.6px of reach against a
panel 72px and 112px tall at the narrowest supported widths), so nothing changes visually.

**The 1px mask overlap in `BottomRightCorner` was not this bug.** It addresses a different seam,
where the intersection masks meet the panel, and the panel's left edge lands on a fractional device
pixel at *both* breakpoints — 0.703 below `md` and 0.484 above, the worse of the two — so it cannot
explain a symptom that only appears when narrow. Edge geometry there was already correct.

Verification note for whoever picks this up next: a 1–2 device-pixel seam is **not visible in a
downscaled screenshot**, so do not try to confirm this one by eye through tooling. Compute the
clearance from `getBoundingClientRect()` and the computed `border-*-radius` instead; that is what
localised it after looking at pictures failed.

---

### 2026-08-06 — Pricing constants read from the oracle, not derived from a headline price

Every rate in `pricing.ts` was wrong, and had been from the start. The cost simulator quoted
31,557,562 seconds for $8 on a 5-character name where the oracle gives 31,535,917 — about six
hours of renewal time per year that we promised and the contract would never have delivered.

The cause was a plausible-looking derivation. ENS v2 prices 5+ character names at $8/year, so the
per-second rate was computed as `8e12 / YEAR_SECONDS` with `YEAR_SECONDS = 31_557_600` — a Julian
year, 365.25 days, which is what "a year in seconds" usually means and what ENS v1's registrar
controller happened to use. The v2 oracle uses a flat **365 days, 31_536_000**. The rates come out
0.07% low, which is small enough that nothing looked broken and large enough to matter on money.

The same constant defined `TIERS[].start` as `6/3/2 × YEAR_SECONDS`, so the discount thresholds
were wrong too, and it is *also* the seconds→years divisor for display — meaning a half-fix that
corrected only the rates would have rendered a genuine three-year renewal as "2 years 11 months".
All of it moves together or none of it does.

Now taken verbatim from the deployed testnet oracle:

| | `getBaseRates()` | was |
|---|---|---|
| 3 chars | `20_294_267` | `20_280_377` |
| 4 chars | `5_073_567` | `5_070_095` |
| 5+ chars | `253_679` | `253_505` |

with `getDiscountPoints()` durations `63_072_000` / `94_608_000` / `189_216_000` (the numerators
were already right). Thresholds move accordingly: the 3-year tier starts at `$16.500044`, not
`$16.500020`, and the six-year at `$27.000071`.

**The algorithm was never wrong** — checked line by line against a reference `quote()` contract
running against the live oracle, and then differentially tested over 77,886 amount/label-length
pairs, including every threshold ±3 micro-units, with zero mismatches. Two things that look like
discrepancies and aren't: the oracle returns only three discount points, with no `{0, 1e38}`
sentinel, so the contract's post-loop `duration = budget / rate` is the live full-price path rather
than dead code — our synthetic `{start: 0, numer: DENOM}` tier reduces to exactly that same floor
divide. And our tier test (`budgetMicro >= tierCost(tier)`) is not the contract's test
(`candidate >= point.duration`), but the two are provably equivalent: both reduce to
`floor(start·rate·numer / 1e38) <= budget`. Neither is worth "fixing" into the other.

The rule that follows: **never re-derive a constant the oracle will hand you.** A headline price
like "$8/year" is not a specification — it doesn't say which year. `YEAR_SECONDS` is now documented
as the oracle's year with the tier durations as its witnesses (they are exact multiples of it), so
a future change to it has to explain why all three thresholds moved.

**Follow-on: no one-year quick-select, and the near-miss label stays honest.** With the rates
corrected, $8.10 renders as "11 months, 30 days" — accurate, but awkward next to a tab header
reading `vitalik.eth · $8/year`. The gap is 83 seconds: a year costs `$8.000021`, so a round `$8`
falls 21 micro-units short. Every length has the same shape (3-char is 1 second short, 4-char 2).

Rejected: rounding the label up to "1 year" within some epsilon. That is precisely the `fmtUsdc`
trap recorded below, moved into the largest text on the panel, and false for a purchase the user
could still fix with a cent. Also rejected: switching to days-only under a year ("364 days") — it
reads cleaner but is no more accurate, still understates by a day, and costs resolution in the
middle of the range, where "7 months" becomes "213 days".

**Built, then removed: a fourth quick-select at `$8.11` → `$8.01` applied → "1 year".** It was
mechanically correct — `ceilToCent()` exists so a quick-select never undershoots a boundary, and it
was applied to all three discount tiers but not to the one duration ENS advertises. It was pulled
anyway, on positioning. `$8/year` is an anchored number in the ENS community; a button reading
`$8.11 → 1y` sitting under a header reading `$8/year` puts a Namepass-specific surcharge on screen
next to ENS's own price, and reads as skimming no matter how the cent is explained. The cent is not
ours — it is ENS's rounding plus the disclosed $0.10 allowance — but a button is the wrong place to
have to explain that.

So the shortfall is left where a visitor only meets it if they go looking: type `$8.00` and you get
"11 months, 30 days" with the exact second count beside it, which reads as a units artifact and is
understood as one. Nothing is rounded and nothing is hidden; it simply isn't advertised.

If a future session finds this and thinks the missing one-year mark is an oversight: it isn't, and
`payableThresholds()` is intentionally discount-tiers-only. It also feeds `nextTierHint()`, so a
one-year entry there would additionally generate a top-up prompt to "unlock" a discount that does
not exist.

---

### 2026-08-05 — CI removed entirely

`.github/workflows/claude.yml` is gone, and with it the repo's only workflow. Nothing runs on push
or on a pull request now.

It was the Claude Code Action, expanded on 2026-07-27 from `@claude` mentions to *every* PR open and
push. That expansion is what made it expensive: it billed the owner's Claude subscription on every
synchronize, whether or not a review was wanted, and this session's branch alone would have
triggered a full review of a very large diff.

Worth being explicit about what leaves with it, since the two earlier entries below describe a CI
that no longer exists: nothing now checks that `npm run build` passes before a merge, and the repo
has no type-check gate of any kind. There is also no test suite, so the entire verification story is
"run it locally". Anyone adding CI back should start with the build rather than a reviewer.

The `CLAUDE_CODE_OAUTH_TOKEN` secret still exists in the repo settings and is now unused. It should
be deleted there; removing the workflow does not revoke it.

---

### 2026-08-05 — Two hairlines on the hero, and neither was CSS

**The line down the right edge of the video is in the asset.** Sampling `cinematic2.mp4`'s own
pixels: the rightmost column averages `rgb(1,2,2)`, effectively black, and the one beside it
`rgb(99,104,103)`, against an interior around `rgb(164,172,172)`. The left edge is clean. It is an
encoding artifact, not a layout gap: the video's box matches the card exactly, and painting the
section red behind it showed no bleed anywhere.

It only appears when the card is proportionally **wider than the video's 16:9**, because
`object-cover` then scales to width and shows every source column. That is why it shows at full
width on a laptop and not in a tall window, and why it is easy to look for in the wrong place.

`scale-[1.02]` on the video is the fix, and it is a crop rather than styling. At the failing aspect
it discards 19 source columns a side, against the 2 that are bad. Worth deleting if the asset is
ever re-encoded clean, which is why the comment says so.

> **Update 2026-08-08.** The crop survives but `scale-[1.02]` does not — it is now `-inset-1` with
> matching `w-`/`h-` calcs. A transform makes the video its own compositing layer, whose rounded
> clip is computed and *then* scaled, so its corner arc stops landing on the painted content's and
> the difference shows as a hairline. Sizing the box does the same crop without the layer. The
> 4px overhang that leaves is not free: see the 2026-08-08 corner-seam entry, where it turned out
> to be what made the pull-back geometry fail at narrow widths.

**The curved line on the Explorer corner is antialiasing arithmetic.** That corner is three shapes
meeting: a panel with a rounded top-left, and two SVG masks filling the concave transitions either
side. Where two antialiased edges of the same colour butt together their coverage does not sum to
full opacity, so a fraction of the video shows through along the joint and reads as a faint curve.
The masks now lap one pixel over the panel instead of meeting it exactly. The overlap is inward
only, so the silhouette against the video is unchanged.

> **Update 2026-08-08. This half of the entry is wrong, and the overlap it describes was never in
> the committed code.** The curved line was not the mask joints; it was `PageShell`'s video
> pull-back radius being too small at the base breakpoint, so video sat behind the *card's* clip
> arc. The mask overlap was written, left uncommitted, and has now been reverted — it addressed a
> seam that measurement does not support: the panel's left edge lands on a fractional device pixel
> at **both** breakpoints (0.703 below `md`, 0.484 above), so mask geometry cannot explain a
> symptom that only appeared when narrow. The diagnosis in the paragraph above — that abutting
> antialiased edges leak `a - a^2` — is sound arithmetic; it was simply applied to the wrong pair
> of edges. See the 2026-08-08 entry at the top.

Both were diagnosed by measurement rather than inspection, and both had to be reproduced at the
right viewport first: a screenshot of a 1920px viewport is downscaled to 800px, which erases
exactly the one-pixel detail being investigated.

### 2026-08-05 — Live feed animation: height-driven push, one curve, newest-first

The feed felt clunky. Three separate causes, only one of which was the animation itself.

**Rows teleported instead of being pushed.** Settled rows had no enter animation beyond opacity, so
an arrival changed the container height in a single frame and everything below jumped. Rows now
grow from zero height on enter and collapse to it on exit, inside an `overflow-hidden` wrapper. The
rows below are then moved by ordinary document flow, continuously, every frame.

Deliberately **no `layout`/FLIP anywhere**. FLIP and an animating height fight each other: FLIP
measures a before and after position while the height is still moving, and the correction it
applies is itself wrong by the next frame. The old code had `layout` on in-flight rows and nothing
on settled ones, which is where a good part of the jitter came from.

**Enter and exit now share one curve, and that fixed the worst of it.** A settling transfer removes
its in-flight row and adds its renewal in the same frame, so a row further down is pushed by the
arrival and pulled by the departure simultaneously. With a 440ms enter against a 260ms exit those
did not cancel: measured on a tracked row, it travelled **down 37px, then back up 22px**. Matched
curves bring the overshoot to zero.

Curve chosen by measurement rather than taste. `[0.22, 1, 0.36, 1]` at 420ms is heavily
front-loaded and peaked at **8–10px of movement in a single frame**, which reads as a lurch
followed by a glide. `[0.4, 0, 0.2, 1]` at 450ms peaks at **5–6px** across the same ~50px pushes,
with overshoot still zero.

**The feed holds a fixed 14 rows, in-flight and settled together**, so it never changes height and
nothing below it moves. An arrival at the top is paid for by a departure at the bottom in the same
frame and the two cancel.

That arithmetic is the same one that was wrong before, and it only works now because a settling
payment keeps its row. It crosses from the in-flight group into the settled one as the same
element, and the settled limit grows by exactly the slot the in-flight group gave up: nothing
enters, nothing leaves. With different keys on the two sides it shifted three rows at once.

A constant row count got that to 3px of residual movement, from the growing and shrinking rows not
being perfectly complementary frame by frame. **The height is now pinned outright**: the rows
container is `overflow-hidden` at `11.5` rows with a 64px fade at the bottom edge, and the surplus
rows live below the fade as slack. Arrivals push the surplus under the edge, departures happen out
of sight, and no row count or row height can move the container. Measured over 20s of live updates:
clip 756px, feed 800px, page 3375px, each a single value, **scroll drift 0px**.

The row height is measured rather than hardcoded, because a row is one line on desktop and a
stacked card on mobile. It is averaged across the rendered rows so a row without an applied
sub-line can't skew the unit, and re-measured on resize.

`VISIBLE_ROWS` is fractional on purpose. Landing on a row boundary makes the last row look
accidentally cut; half a row under a fade reads as more to come.

This also removed the `-mb-px` that used to tuck the last row's divider under the container border,
which is why the last row rendered and hovered unlike every other one. With a clipped container
there is no last row at the boundary at all: rows simply continue under the fade, every one
identical. Hit-testing is clipped with the overflow, so nothing below the fold is hoverable.

**In-flight rows sort newest first.** `activeFlows()` walked the registry in seed order, so
in-flight rows were ordered by name. A payment that had just started could render below one that
had been bridging for fifteen minutes. `ChainFlow` gained a `startedAt` and the list sorts on it.

**A settling payment keeps its row.** The last flicker: an in-flight row was keyed `name-chain` and
its renewal `name-chain-timestamp`, so finishing destroyed one element and built another, complete
with a collapse and an expand for something that had not moved. `ActivityEvent` now carries a
`flowKey` matching the flow it came from, and `InFlightRow`/`SettledRow` collapsed into one
`FeedRowContent`. React keeps the same node and re-renders it. Measured on a real settlement: the
same DOM node survived and moved **0px**.

That is what forced the applied sub-line to render while a payment is still bridging. It is a
projection, which is the same promise `~6.0y` already makes, and it keeps the row exactly the same
height on both sides of settlement. Without it the row grew by a line at the moment it settled,
which is the push-down all over again for an event where nothing should move at all. What changes
now is the tint, the `~` becoming a `+`, the time-added colour, and a crossfade in the status cell.

The status cell needed its own fix. An `AnimatePresence` swap flickered either way round:
`popLayout` pops the outgoing label out of flow and the cell collapses for a frame before the new
one sizes it, and `mode="wait"` leaves a visible gap. Both labels are now always mounted and
stacked in one grid cell, so the cell is as wide as the wider of them and the crossfade changes no
geometry at all. Measured across a settlement: width fixed at 71px and left edge at 757px for every
one of 51 frames.

The `flowKey` includes `startedAt` so a later payment on the same name and chain cannot collide
with a settled row still on screen.

What was *not* changed: in-flight rows stay pinned above settled ones rather than interleaving
chronologically. A new payment enters as pending, so it still appears at the very top of the feed;
and grouping keeps the moving parts in one place instead of scattered through the list. The
alternative is a single chronological list, which would need a settling row to keep its deposit
time as its sort key, or it jumps position at the moment it settles.

### 2026-08-05 — Hub chain becomes a constructor argument, and a copy pass

**`hubChainId` replaces the hardcoded `ETHEREUM_CHAIN_ID = 1`.** Testnet ships first, so the
mainnet-only constant had to go. A constructor argument rather than an edited constant: one source
file serves both deployments instead of a source change that has to be remembered at deploy time.
It is part of the creation code, so it must be identical across every chain in a set, and a testnet
set and a mainnet set therefore land on different factory addresses. That is correct rather than a
side effect: they are separate deployments with separate deposit addresses. `HUB_CCTP_DOMAIN` stays
a constant at 0, which holds for Ethereum mainnet and Sepolia alike.

This reverses the 2026-08-04 call to keep it hardcoded. The reasoning there was sound for a
mainnet-first launch and stopped applying when the launch order changed.

**Copy pass**, three rules now in force:

- **No em dashes in user-facing text.** They read as machine-written. Sentences were split or
  repunctuated rather than swapped for hyphens; the table placeholder glyph is now `-`. Code
  comments still use them.
- **The supported-tokens page says less.** It is a page people check an address against, not one
  they read, and three explanatory sections were cut. Kept: what is accepted, that it is testnet,
  that nothing else is recoverable, the four addresses, and that balances don't combine.
- **No unfalsifiable filler.** "Every address below is a test contract" said nothing a reader could
  act on; "This USDC has no real value" is the fact they need.

The hero title and body were grey (`#5E6470`) while every other heading used the navy
`rgba(30,50,90,·)`. Now navy, which also reads better against the video.

### 2026-08-05 — Polygon out, Circle's Arc in; and the app points at testnets

Two changes that travel together, since both touch every place a chain is named.

**Arc replaces Polygon.** Supported chains are now Base, Arbitrum, Ethereum and Arc — Circle's own
L1, CCTP domain 26. Worth knowing when adding or removing one: a chain lives in eight places, and
missing any of them ships a half-migration. `registry.ts` (pool), `fees.ts` (`FEE_CHAINS`),
`format.ts` (explorer map), `tokens.ts`, `ChainTag` (colour + ping delay), `PassCard` (`CHAINS`),
`BottomLeftCard` (rotation), and a logo in `public/logos/`.

Arc has two quirks the UI has to state rather than smooth over. It pays **gas in USDC**, so the
token sits at a system predeploy — `0x3600…0000` — which looks like a typo on a page whose whole job
is "check this matches exactly", hence the per-token `note` field. And its brand navy `#1B3158` is
almost the Namepass accent; the chain dot uses it anyway, because it still reads as distinct from
Base's and Arbitrum's blues and inventing a brighter Arc colour would be inventing a brand.

**The app is a testnet deployment**, and says so in two places at two volumes. `lib/tokens.ts` now
carries Sepolia, Base Sepolia, Arbitrum Sepolia and Arc Testnet addresses behind an `IS_TESTNET`
flag, `format.ts`'s explorer map points at the matching testnet explorers, and the supported-tokens
page leads with a callout. Above all of it sits a slim marquee strip on every route.

Three calls on the strip:

- **Not dismissible.** "This is a testnet" is not a notice someone should be able to close and then
  forget while looking at a deposit address. It costs ~32px and stays.
- **Outside `PageShell`, not inside.** The shell is the app; this is a statement about the
  deployment. Inside, it would read as a feature of whichever page you happened to be on.
- **Paused under `prefers-reduced-motion`.** A permanently moving element is exactly what that
  setting exists for.

The real risk here is a half-flip later: `IS_TESTNET`, the addresses in `tokens.ts` and the explorer
map in `format.ts` must move together. A banner saying "testnet" above mainnet addresses, or the
reverse, is worse than either alone — noted in `CLAUDE.md` too.

### 2026-08-05 — The CCTP fee ceiling is a per-call argument, not contract state

The last owner-controlled liveness lever, removed. `_maxFeeBps` is gone from storage, `setFees`
became `setFinality`, and the ceiling now arrives with each call:

```
renew(label)                    // authorizes 0 — the default
renewWithFee(label, maxFeeBps)  // caller names their own ceiling
```

The goal it serves: **never pay a fee unless Standard starts charging one, and be able to move to
Fast the day it becomes free.** `renew` authorizes nothing, `setFinality` handles the second, and
`renewWithFee` covers the case in between.

What makes it better than a stored value is the failure it removes. If Circle ever prices the tier a
chain is set to, every zero-fee burn reverts, and with the ceiling in storage the funds would sit at
their deposit addresses until the *owner* noticed and acted. Permissionless `renewWithFee` means any
funder can push their own payment through immediately. That was the last thing an owner could
withhold — deliberately or by being asleep — and the fee decision now sits with whoever is paying
gas to make the transfer land, which is the person who wants it to succeed.

Two named functions rather than an overloaded `renew`: Solidity has no default arguments, and
distinct selectors read more clearly from a frontend than two entries that differ only by signature.

**Accepted trade.** Because `renewWithFee` is permissionless, anyone can authorize Circle's fee on
someone else's deposited USDC. They cannot receive it, redirect anything, or make Circle take the
full ceiling — Circle charges its actual fee and mints the rest. So the worst case is a funder
paying the going rate for speed they did not ask for, and only on a chain set to Fast at all. On a
Standard chain with a zero fee, a stranger's generous ceiling costs precisely nothing.

**Residual.** `setFinality` is still owner-only and has no per-call override. Circle documents
nothing for thresholds between 1001 and 1999, so an owner setting one is an unquantified risk. The
fee half is closed; the speed half is not.

### 2026-08-05 — Ownership goes two-step, and the clone address is verified on deployment

Second audit round on the factory. Both findings accepted, and one of them inverts reasoning I had
written into the contract.

**Two-step ownership.** The contract said single-step was deliberate, on the grounds that a botched
transfer "costs the ability to retune CCTP fees rather than custody of anything". That gets the
weight backwards. Retuning is the *only* defence a deposit wallet has against Circle changing
something, and wallets are permanent — a mistyped address would strand every published address on
today's settings forever, with no redeploy available. The owner being unable to move funds makes
two-step **more** appropriate, not less: it protects liveness and adds no custody power.
`transferOwnership` now nominates, `acceptOwnership` completes. Renouncing is still impossible,
which is a separate open question.

**Verify the deployed clone matches the prediction.** `predictDeterministicAddress` and
`cloneDeterministic` are two independent assembly blocks that must agree. They do — verified byte
for byte against an external CREATE2 implementation, 14 checks — but only one of them could be
edited later, and that failure is silent and unrecoverable: funds sent to the advertised address
with the code deployed somewhere else. One comparison on the first-deployment path removes the
possibility. Cheap insurance on exactly the kind of one-way door this contract is full of.

Also corrected, all comment-level: the finality-threshold NatSpec asserted behaviour for the
1001–1999 range that Circle does not document; `setFees` still carried a stale paragraph claiming a
zero fee cap makes Fast burns revert, contradicting the degradation explanation three lines above it
and describing a check that no longer exists; and `maxFeeBps` was described as unbounded when it is
bounded by `uint16` at 65,535 bps — harmless, since `maxFee` is clamped below the transfer amount,
but "unbounded" was wrong.

The stale paragraph is worth noting as a pattern: it survived because removing a check and removing
its justification are two edits, and only the first one fails to compile.

### 2026-08-05 — What an insufficient CCTP `maxFee` actually does

This one claim has now been wrong three times, so here is the rule with a source, and it should not
be re-derived from memory again.

Per [Circle's fee docs](https://developers.circle.com/cctp/concepts/fees) and
[Finality Thresholds and Fees](https://developers.circle.com/cctp/cctp-finality-and-fees):

- A `maxFee` below the **Fast Transfer** fee does **not** fail. Circle **degrades the transfer to
  Standard**.
- The burn reverts on chain only if `maxFee` is below the minimum **Standard** fee. That fee is
  zero today, so no ceiling reachable through `setFees` — including zero — can strand a burn.
- `minFinalityThreshold` is collapsed by Circle: anything below 1000 becomes 1000, anything above
  becomes 2000. Two meaningful values *today* — which is why the contract does **not** validate it.
  See below.

The three wrong versions, for the record: first "Circle will not pick it up", implying a stranded
post-burn transfer; then, from the external audit, "an insufficient `maxFee` causes the source
transaction to revert"; then a security note claiming an owner could stall an L2 by selecting fast
with a near-zero ceiling. All three assumed failure. The real behaviour is a silent downgrade.

Three consequences. The `setFees` check rejecting fast-with-zero-fee is **removed** — it refused a
configuration that works. The owner stall vector via fees does not exist: the worst a bad fee
setting does is quietly give you standard speed when you asked for fast. The burn cap remains the
only setting that could stall a chain, which is what `MIN_MAX_BURN` is for.

And the threshold is no longer validated at all on an L2. Accepting only 1000 and 2000 encoded
Circle's *current* tiers into permanent bytecode: if they add a tier or move the boundaries, a
factory that only accepts today's values could never use the new ones, for any address ever
published. The protection it offered barely existed anyway — with `maxFeeBps` at 0, a mistyped
threshold that lands on fast is degraded straight back to standard by Circle, so the typo
self-corrects. It takes a wrong threshold *and* a generous ceiling to have any effect, and the
effect is paying for fast. Not worth a permanent constraint. The cost is that a threshold of 0 now
means fast rather than "unset", which is documented rather than guarded.

What remains is a pricing dependency, not an attack: if Circle's standard fee ever rises above the
configured ceiling, burns revert and L2 funds wait at their deposit addresses until it is raised.

### 2026-08-05 — The CCTP fee ceiling is unbounded, and the reasoning behind bounding it was wrong

`maxFeeBps` had a hard limit — 100 bps originally, raised to 500 during the audit response. Both
were justified by the same claim: that a fat-fingered high value would "silently donate deposits to
Circle". **That claim was false.** `maxFee` is what Circle is *authorized* to take, not an amount
paid. Circle collects its actual fee and mints the remainder, which is exactly why the L1 helper
computes `burn.amount - burn.feeExecuted` rather than subtracting the cap.

So there is no failure mode on the high side to protect against, and the bound was guarding
nothing. It is gone. Values over 100% are harmless too — `maxFee` is clamped to `amount - 1` before
the burn.

The direction that actually matters is *down*, and it is not symmetric: a ceiling under Circle's
real fee makes the burn revert at the source, and with no sweep, funds stranded that way at an L2
deposit address can never be moved. That is a pricing dependency on Circle, not an owner power —
see the correction below.

Worth noting what this cost to get wrong: the false premise survived an external audit round, two
different bound values, and a NatSpec comment explaining the tradeoff in detail. None of that made
it true. It was corrected by someone who knew how CCTP settles.

### 2026-08-05 — Per-burn cap, and no reentrancy guard

Circle limits a single CCTP burn to 10,000,000 USDC. The failure mode this creates is worse than a
plain revert: because `renew` burned the whole balance, an over-limit balance would retry as the
same oversized burn every time and never clear. A one-off failure that recovers is fine; one that
reproduces itself forever is a stuck deposit.

`renew` now processes at most `maxBurnAmount` per call and repeated calls drain the remainder.
`DepositProcessed` gained a `remaining` field so the backend can tell "call again" from "wait for
another deposit" without re-reading chain state.

**The cap lives in the contract and nowhere else. The UI deliberately does not model partial
burns — don't "fix" that.** Working the numbers afterwards: 10,000,000 USDC buys roughly 1.2
million years on a 5+ character name and ~16,000 years on a 3-character one. No deposit reaches
this cap, ever. A sixth `holdReason`, a `maxBurn()` export, simulation support and copy were all
drafted and then thrown away — that is permanent complexity in the domain model for a state no
user will see, and it cuts against the `name_inactive` precedent about not splitting states that
change nothing for the funder. `flow_in_progress` already reads correctly if a remainder somehow
occurs ("these funds are queued and go out with the next one").

The contract keeps it anyway, and the reason is not probability — it is that this is a one-way
door. Wallets delegate to the factory permanently, so anything absent at launch can never be added
for an address that has already been published, and with sweep removed an over-limit balance would
be unrecoverable by anyone. A comparison in `renew`, a packed storage slot and a setter, against an
unfixable total loss, is worth it at any probability. The same asymmetry is absent in the UI, where
the cost is ongoing and the failure is merely a slightly generic tooltip.

Calls made along the way:

- **Owner-adjustable, not a constant.** It is Circle's number and it can move, and a redeploy is
  not a remedy here — wallets delegate to this factory permanently, so a new factory would not
  repair a single existing address. It joins the fee cap and finality threshold in the
  mutable-but-harmless bucket: none of the three can change *where* funds go, only what they cost,
  how long they wait, and how much travels per transaction.
- **Defaulted at `initialize` rather than left at zero.** Zero would mean unbounded, so a factory
  could go live with no cap at all if someone forgot the follow-up call.
- **A floor of 100,000 USDC under the cap, because an adjustable cap is a pause switch.** This was
  first added for the wrong reason — protecting against a mistyped value with six invisible
  decimals — and then removed as over-engineering. It came back once the actual reason surfaced: set
  the cap to one micro-unit and every `renew` on that chain moves 0.000001 USDC, so L2 deposits
  become unprocessable while sitting perfectly safe at their addresses. That is precisely the
  liveness permissionless `renew` was introduced to guarantee. With the floor, no payment at or
  below 100,000 USDC can be affected at all, and a larger one can only be split, never stopped.

  There is no equivalent hole in `setFees` — see the fee-ceiling entry above. A ceiling too low for
  a fast transfer degrades to standard rather than failing.
- **Ethereum stays uncapped**, because nothing is burned there. The setter enforces the two ends of
  that: zero is rejected on an L2, where it would be indistinguishable from bricking every deposit,
  and non-zero is rejected on Ethereum, where a stored value would later read as though it
  constrained something.
- **`uint96`, packed with `_tokenMessenger`.** Exactly 32 bytes, so the cap costs no extra storage
  slot and `renew` reads a slot `walletParams` warms anyway. It tops out near 79 trillion USDC.

**No reentrancy guard**, deliberately. Nothing per-payment is written before the external calls,
and the three reachable destinations — native USDC, the Circle messenger, the helper — are all
frozen at initialization, so there is no untrusted callee to reenter from. A guard would add a
storage write to every processing call for no strengthening of this flow.

One correction to the reasoning that motivated it, now that burns can be partial: a reentrant
`renew` would not find an *emptied* balance, it would find a *reduced* one. The conclusion is
unchanged — it would take another legitimate slice to the same frozen destination for the same
name, and the second read is live, so nothing can burn more than exists. Worth stating precisely,
because "the balance is zero afterwards" stopped being true the moment the cap landed.

### 2026-08-04 — `fetchProfile` gives up abort-on-unmount to keep deduplication

ENS profiles were rendering blank — no avatar, "No description set.", no links — while the resolvio
API was healthy and answering in under 30ms. The app was throwing the response away.

`fetchProfile` does two things that turn out to be in direct conflict. It **deduplicates**, so two
components asking for the same name share one promise, and it accepted an **`AbortSignal`**, which
was bound to the underlying `fetch`. `NameAvatar` calls it without a signal; `NameDetail` calls it
with one. Whichever got there first created the shared request — and if that was `NameDetail`, its
unmount cancelled the request for everyone else. The `catch` correctly declined to cache the
result, so nothing was poisoned, but nothing re-fetched either: the second effect run had already
consumed the dying promise. Under StrictMode's double-invoked effects this is close to guaranteed
rather than a race, which is why it looked intermittent and unrelated to any recent change.

You cannot cancel a shared request on behalf of one of its consumers. Deduplication is the more
valuable half — it is what stops a leaderboard of twenty rows firing twenty identical requests — so
**the signal is gone**. Callers now ignore late results instead, which they were already doing
(`NameDetail` guarded every `setState` behind an aborted check; that check is now a plain
`cancelled` flag, which is what it always was in practice). Letting an abandoned request finish is
a bonus, not a leak: it warms the cache for the next mount.

The tempting "fix" here is to give each caller its own request so each can cancel safely. That
trades a correctness bug for an N-requests-per-name bug. The other tempting fix is to reintroduce
the signal to "clean up properly" — noted in `CLAUDE.md` so a future session doesn't.

### 2026-08-04 — Supported-tokens page is a whitelist, not a list of things to avoid

Removing sweep from the factory made wrongly-sent tokens unrecoverable, so the mitigation moved to
the UI: a `/supported` page listing the exact native USDC contract per chain.

The obvious version lists bridged `USDC.e` on Arbitrum and Polygon as tokens *not* to send, since
that is the mistake people actually make. Rejected — it inverts the check into "is this on the bad
list", which fails open for every token nobody thought to enumerate. "Does it match one of these
four addresses exactly" fails closed. `USDC.e` is still named in prose, as a reason to check the
address rather than the ticker, but its addresses are deliberately not published: an unverified
address on a *don't-send* list is worse than no list, because getting it wrong tells someone a real
bad token is fine. The four addresses that *are* published were checked against Circle's own list
rather than recalled or copied from an explorer search, and `lib/tokens.ts` records the date and
source.

`ChainTag` is deliberately **not** reused here — the one place that standing rule is broken on
purpose. Its pulsing dot reads as a live signal and nothing on this page is live; the chain logo
already names the chain, so the dot would also have been saying it twice.

The copy avoids explaining the missing sweep as a limitation. It is framed as the trade it actually
is: a function that could move tokens out of your deposit address is a function that could move
your USDC, so there isn't one.

`PassCard` links to it from the "USDC accepted" block, and `onSupportedTokens` is a **required**
prop rather than an optional one. That is deliberate: the link is the mitigation for sending an
unrecoverable token, so a future `PassCard` usage should fail to compile rather than quietly ship
without it. Costs a little prop drilling through `Explorer` and `Leaderboard`, which is the right
trade for an affordance that must not silently disappear.

### 2026-08-04 — No sweep, and everything that can move money is frozen

External audit of the factory found the custody model was still broken after the first review pass,
and it was right. Freezing `l1Helper` closed one redirect route and left two open, through config
fields that were still owner-mutable:

- **Change `usdc`, then sweep the real USDC.** Both sweep guards compared the token against
  `config.usdc`. Setting `usdc` to any other token made the real one sweepable to an owner-chosen
  `sweepRecipient`. Every deposit balance on every chain was administratively drainable.
- **Replace `tokenMessenger`.** The L2 path approves it and then calls it. An owner-supplied
  contract could take the allowance and pull the wallet's USDC anywhere.

The fix went further than the audit asked. **Sweep is removed entirely** rather than repaired:
a rescue path is by definition a function that moves a deposit wallet's tokens to an
owner-chosen address, and guarding it with a comparison against another owner-settable value is
the shape of the bug, not a hardening of it. Wrongly-sent tokens are now permanently lost, which
is a real cost accepted deliberately — the UI has to say so, and a supported-tokens page listing
the exact USDC contract on each chain is the mitigation.

`usdc`, `tokenMessenger` and `l1Helper` are now set in one `initialize` call and frozen. The only
mutable state is `setFees`, which cannot redirect anything. That also killed the `operator` role,
whose last remaining use was sweep, and the runtime shrank 23%.

Two things worth recording because they are easy to get backwards:

- **Set-once storage, not `immutable`.** The audit recommended `address public immutable usdc`.
  Applying that verbatim would have destroyed the product: constructor arguments are part of the
  creation code, these values differ per chain, so the factory would land on a *different address
  on every chain* — and with it every deposit address. Cross-chain address identity is exactly why
  chain-specific values have to live in storage.
- **The fee cap went up, not down.** It was 100 bps. The audit correctly noted a cap too low to
  cover a future Circle fee makes L2 burns revert forever, with no redeploy available as a remedy
  (wallets delegate to this factory permanently) and now no sweep either. But its suggested 9999
  would let one fat-fingered `setFees` hand Circle 99.99% of every transfer. 500 bps keeps a typo
  bounded while leaving ~35x headroom over any fee Circle has charged.

  > **Superseded 2026-08-05 — the premise was wrong.** A high ceiling hands Circle nothing; Circle
  > takes its actual fee and mints the rest. The bound guarded nothing and has been removed. See the
  > entry at the top.

Also corrected: comments claiming standard CCTP transfers are permanently free. Circle exposes
`getMinFeeAmount` for standard transfers, so a zero fee is current pricing, not a guarantee — which
reaches past the contract into `src/lib/fees.ts` and the flat-allowance model built on it.

### 2026-08-04 — Factory keys on the label, and five calls made during its first review

First draft of `contracts/NamepassFactory.sol` reviewed. The derivation and the ERC-1167 assembly
were correct as drafted and are unchanged. What follows is what changed and why.

- **The CREATE2 key is the label, not the name or its namehash.** `vitalik`, not `vitalik.eth`, and
  a labelhash rather than a namehash. `.eth` is the only TLD in play, so carrying it adds bytes to
  every call and a second way to derive the wrong address. Labels containing a dot are rejected on
  chain: a caller passing a full name would otherwise get a valid address that no renewal can ever
  process, holding USDC that sweep deliberately refuses to move. Fail loudly at prediction time
  instead. The frontend still says *name* to users — that is what users have. Only the on-chain key
  is a label.
- **`renew` is permissionless; the helper address is write-once.** Rejected the operator-gated
  version: it made the backend a liveness dependency for money that is already committed, and the
  destination is fixed by config anyway, so gating bought nothing but an outage mode. The reverse
  call on the helper — an owner who can repoint `l1Helper` can redirect every dollar, which would
  have made the non-custodial claim false. It is set once, then frozen, and cannot be a constructor
  immutable because the helper is deployed second (it hardcodes the factory address to derive
  deposit addresses itself). The trust window is the gap between deploy and `setL1Helper`, and the
  single `L1HelperSet` log is the public proof it closed.
- **A sweep exists, and it can never touch USDC.** Considered leaving deposit wallets with no rescue
  path at all, on the grounds that a sweep is custody surface. Rejected: a published deposit address
  will receive bridged `USDC.e` on Arbitrum and Polygon, and "permanently lost" is a worse answer
  than an operator-gated move of tokens that were never the payment asset. The exclusion is checked
  in both execution contexts rather than once.

  > **Reversed same day, see the entry below.** The second clause was false. Both context checks
  > compared against `config.usdc`, which was owner-mutable, so the guard was a formality — point
  > `usdc` at any other token and sweep the real one. Sweep is gone and the config is frozen.
- **Fast Transfer stays reachable through config.** The finality threshold is validated to Circle's
  two documented values rather than pinned to standard, so a future fee change is a config call and
  not a redeploy — and a redeploy would move every deposit address. A fast transfer with a zero fee
  cap is rejected outright, since Circle would simply not pick it up. Fee cap is capped at 100 bps:
  it authorizes Circle to take a share of a transfer, so a fat-fingered extra zero should not be
  expressible.

  > **Superseded 2026-08-05.** The cap is gone — authorizing more than Circle charges costs
  > nothing, because Circle collects `feeExecuted` and mints the remainder.
- **`block.chainid == 1` stays hardcoded.** *(Reversed 2026-08-05 once testnet-first was decided;
  the hub is now a `hubChainId` constructor argument. The objection below was still wrong for the
  reason given.)* Flagged as a blocker on the grounds that it makes the
  Ethereum path untestable on Sepolia; overruled, and the objection was wrong — this bytecode is for
  mainnet, and a Foundry fork test with `vm.chainId(1)` exercises the path without adding a config
  knob that could be misconfigured in production.

Two things pinned down that read as style but aren't. `depositForBurnWithHook` is declared returning
nothing, because the `uint64 nonce` return is the CCTP **V1** signature and declaring it against V2
makes Solidity enforce a returndata size and revert on every burn. And `foundry.toml` pins the
compiler version, EVM version, optimizer runs and `bytecode_hash = "none"` — identical creation code
across four chains is the entire premise of the address scheme, and a floating pragma or an embedded
metadata hash silently moves every address the product has published.

### 2026-07-29 — Hold reasons cut to five, and the minimum is stated

Review pass on the pending-balance model. Two states removed, one number surfaced, plus a
shared-mutable-state bug that the review is what caught.

- **No `awaiting_confirmations`.** Removed the day it was added. Webhooks fire on *finalized*
  deposits, so there is no moment where the app knows money is coming but hasn't arrived — it
  modelled something the platform cannot observe.
- **`premium_auction` + `unregistered` → `name_inactive`.** Expired, mid-auction and
  never-registered are different on-chain situations that make no difference to a funder: the name
  can't be renewed and the money waits. Three reasons were three ways of saying that.
- **The minimum is now stated, not just enforced.** `minTrigger()` (currently **$0.67**, derived
  from the 15% ratio) is exported so the card can say "under the $0.67 minimum on this chain".
  "Too small" without the number leaves nobody able to act on it — the funder can't tell whether
  they're 20¢ or $20 short.
- **The accumulation path was modelled but unobservable.** A second payment topping up a
  sub-threshold balance has always worked, but picking name and chain uniformly at random across
  12 names × 4 chains made hitting the same pot twice so rare you'd never see it. Payments now
  prefer a chain that's already stuck under the threshold, which is also what really happens.
  Verified: 49 accumulation events over 600 ticks, versus effectively none before.

**Bug found in review: `pending: { ...NO_PENDING }` shared its arrays across every name.** A
shallow spread copies the `balances`/`flows` *references*, so `park()` pushed into one array that
all twelve names pointed at, and a balance for one name appeared on the others until something
happened to reassign them. It surfaced as the non-renewable name showing a failed transfer, which
should be impossible — a flow can't start on a name that can't be renewed. Replaced with an
`emptyPending()` factory. Verified over 600 ticks: no shared arrays, and zero leaked states onto
the inactive name.

Two smaller display calls from the same pass:

- **The collapsed summary asks `canTrigger` rather than filtering on the reason**, because reason
  alone promised "needs a retry" on names where no button ever appears.
- **The runway bar reads "+27.4 years via Namepass", not "years added".** The expiry above it is the
  name's real one, and an owner may well have renewed elsewhere too — the unqualified version
  claimed credit for time Namepass didn't deliver. Also dropped "Already on Ethereum — no transfer
  needed" from the breakdown; the transaction list already shows there was no burn.
- **Time delivered is formatted adaptively** — `fmtDelivered()` gives days, then months, then years
  and months. No single unit works: a 3-character name's renewals are measured in days (months
  rounds them to "0 months"), most names sit under a year (where "0.4 years" reads as nothing), and
  the heavily-funded ones reach decades (where "264 months" is arithmetic homework). The
  leaderboard's ranked figure switches unit at the same boundaries as the subtitle under it.
- **Leaderboard rows gained a "View <name> activity" link** — they showed an address but no way to
  reach the history. Styled to PassCard's own radius, border and white surface, since a bare
  bordered button read as grey against the panel behind it.
- **`op.eth` removed from the seed data; three characters is the floor.** ENS v2 prices nothing
  below three characters, so a 2-character name isn't registerable and any payment to it buys zero
  time — it sat in the leaderboard claiming "4 renewals · 0 months delivered". Replaced with
  `nouns.eth`, documented on `SEED_NAMES`, and the activation path now refuses short names outright
  rather than minting an address that could never work.
- **An un-renewable name's whole runway shifts back, not just its final expiry.** Overwriting the
  end alone gave `ens.eth` "at activation: 2027 → now: expired", which says time ran backwards past
  nine renewals that genuinely added some. Sliding the timeline keeps the arithmetic intact: it was
  already near expiry when the pass was activated, renewals pushed it out, it lapsed anyway.
- **The simulation only touches the demo's own names.** A Namepass a visitor just activated was
  being fed invented payments from strangers within seconds, overwriting the one true thing the
  page could say about it — "waiting for the first payment".

### 2026-07-29 — Every resting balance must be explained, so addresses start empty

**A deposit address is a pass-through, not a wallet.** Money sitting in one is always either
blocked by something or a failure — so a balance shown with nothing wrong with it tells the funder
the automation stalled and is waiting on them, which is the opposite of what the product claims.

Caught in review: `vitalik.eth` held $24.50 on Base and `uniswap.eth` held $11 on Base, both with
`holdReason: null`, rendering as "· ready". Ready for what? Had a transfer failed? Was the deposit
too small? The card couldn't say, because there was nothing to say.

Three changes, in increasing order of how much they prevent a recurrence:

1. **`holdReason` is non-nullable.** An unexplained balance is now unrepresentable rather than
   merely absent from the fixtures.
2. **Every address seeds at zero.** Pending states are grown by the simulation from arriving
   payments, so each one carries the reason that parked it. The happy path — payment lands, clears
   the floor, goes straight out — became the common case rather than an absence, which is also a
   truer demo: a healthy address shows *no card at all*.
3. **Only anomalies are triggerable.** `canTrigger` now requires `not_detected` (the webhook never
   fired) or `flow_failed` (a burn was attempted and didn't go out) — the two cases a person can
   actually clear. Offering a button for `below_threshold` or `awaiting_confirmations` implied the
   automation needed supervision for states it resolves on its own. `not_detected` is new; the
   webhook-failure case previously had no reason of its own and would have shown up as an
   unexplained balance.

Consequences worth knowing:

- **A queued balance now starts its next flow the instant the previous one settles**, rather than
  reverting to a null reason. That's both what the backend would do and the only way to keep the
  invariant.
- **`awaiting_confirmations` is modelled as the first state of every deposit**, since it was
  otherwise unreachable and its copy was dead. A payment lands unconfirmed, then the next tick
  judges it — which is also how accumulation works, because the whole chain balance is re-judged,
  not just the new deposit.
- Verified over 500 simulated ticks: zero unexplained balances, zero non-positive balances, and all
  six reachable reasons occurring naturally. `unregistered` still has no fixture — every demo name
  shows an expiry above the card, which that reason would contradict.

Related bug fixed at the same time: the collapsed summary reported only the in-flight amount when a
flow existed, so a waiting balance vanished from the headline when a renewal started on a *different
chain* and reappeared when it settled — money seeming to come and go. It now names both.

### 2026-07-29 — Balances are per chain, and the feed shows work in progress

**A single `held` figure was wrong.** A CREATE2 address is identical on every chain, which makes one
global balance look natural — but the balances are separate pots that can never be combined. $5 on
Base plus $8 on Arbitrum is not $13; it's two payments that each have to clear the threshold alone.
`PendingState` is now `balances: ChainBalance[]` and `flows: ChainFlow[]`.

Consequences, all of which the single figure had been hiding:

- **The flow constraint moved from `(name)` to `(name, chain)`.** The stricter version was
  justified by batching mainnet gas — an argument that doesn't survive, since funds on different
  chains can't merge, so there was nothing to batch. Worse, it let a stuck Base transfer block a
  fresh Ethereum payment needing no CCTP at all. A name can now legitimately run four flows.
- **The threshold applies per chain.** 50¢ on Base and 50¢ on Polygon means neither moves, which
  looks like a bug unless the card says so — hence the "balances on different chains can't be
  combined" line whenever more than one chain is funded.
- **Dust strands permanently** on a chain nobody tops up. Shown honestly; no sweep designed.

**The trigger button was re-weighted from primary action to escape hatch.** Normal accumulation is
webhook-driven — a payment lands, the handler checks that chain's *balance* (not the deposit
amount) and goes. The button is for when the webhook or the burn didn't fire. So it now appears
per-chain, only where that chain is actually stuck, and the collapsed card leads with what's
waiting rather than a call to action.

**The card collapses to one line.** Priority: needs-a-retry, then in-progress, then waiting — the
actionable thing first, motion second. Expanding shows one row per funded chain; rows only exist
for chains with a balance, so in practice it's one or two.

**In-flight renewals now appear in the Explorer feed.** With Across a transfer took seconds and
there was nothing to watch; standard CCTP takes 13–19 minutes, so a feed of only settled renewals
called itself "Live" while showing nothing but the past. Rows appear at the burn and update through
the stages. They show projected values as `~6.0y` rather than `+6.0y` — nothing has been added yet,
and if the claim reverts nothing will be.

Two display bugs caught in review, both worth recording because they're the same underlying trap:

- **`fmtUsdc` rounds away the digits that decide a tier.** It renders `$27.000071` (six years at
  43.75% off) and `$27.00` (four years eleven months at 31.25%) identically as "$27" — so the
  breakdown panel showed an amount that, taken at face value, doesn't buy what's beside it. Added
  `fmtUsdcExact` for anywhere a reader checks arithmetic. This is exactly the trap `ceilToCent()`
  exists to prevent, one layer up in the display.
- **The breakdown showed where money went but never the rate it bought at**, so "$27 · 6 years"
  read as an error until you noticed the bulk rate is $4.50, not the headline $8. Added an
  "Effective rate" line.

Also: tooltips are portaled to `document.body`. They live inside accordions that need
`overflow-hidden` for their height animation, which clipped them. And the live-feed grid uses
`minmax(0,…)` columns — bare `fr` has an implicit `auto` minimum, so one long status string was
widening its column at every other column's expense.

### 2026-07-29 — CREATE2 addresses and CCTP, replacing CDP wallets and Across

**Supersedes the 2026-07-28 "Backend shape" entry below.** Two changes, and they resolve each
other's loose ends.

> **Backend provider update, 2026-08-11.** The CREATE2 and CCTP decisions remain current. The
> Moralis ingestion and allocation-ledger details below are superseded by the Goldsky + Neon +
> Vercel decision at the top of this file.

**Addresses are derived with CREATE2**, not issued by a CDP server wallet. A name's address is
computable from the name alone — it exists before anyone claims it and anyone can verify it offline
without trusting a Namepass API. Contract and factory work is deliberately out of scope until this
goes live.

**This makes the platform non-custodial**, which reverses yesterday's correction in the opposite
direction and is worth being precise about, since the log now contains both. Yesterday: the
"address, not agent" framing had been justified with "deterministic, non-custodial, no third party
in the loop", that was false under CDP server wallets, and it was corrected. Today the architecture
makes it true. The framing didn't change to fit the architecture; the architecture moved and the
claim became accurate. For renewal *infrastructure* asking people to send money to an address, that
distinction is the product.

**Bridging is standard CCTP, not Across.** A Moralis webhook hits a Vercel serverless function that
burns with a hook; a Vercel Workflow polls Circle's Iris API for the attestation; when it lands, one
atomic mainnet transaction mints and renews together. Consequences:

- **No fees to quote.** Standard CCTP carries no Circle fee, so the entire per-chain
  estimate/buffer apparatus built the day before is deleted — no quoting, no chain variance, no
  staleness problem, no circular quote. Replaced by a flat **$0.10 gas allowance** on every flow,
  taken by the mainnet contract in the renewal transaction. Universal: an Ethereum-origin payment
  never bridges but still triggers a mainnet renewal, so it carries the same allowance. It is a
  rebate, not cost recovery — a mainnet renewal costs dollars of gas.
- **One allowance per flow**, not per deposit. Several payments that accumulate and settle together
  are one renewal and one deduction; `deposit_allocations` already modelled this.
- **The refund hazard mostly disappears.** A CCTP burn is irreversible — there is no
  refund-to-origin, so `deposits.kind = 'bridge_refund'` and the infinite-retry loop it guarded
  against largely go away. The failure mode becomes "attested but unclaimed", which is strictly
  better: the funds sit as a replayable message rather than bouncing.
- **Burn only after confirming the name is renewable.** Load-bearing. Burn first on a
  premium-auction name and the funds leave the deposit address to sit as an unclaimed message, and
  the pending-balance card has nothing to show — it reads on-chain balance at the address. Gate the
  burn and the existing UI holds.
- **It is slower, not faster.** Standard CCTP waits ~13–19 minutes for attestation where an Across
  intent took seconds. In-flight state now persists long enough that people will reload mid-flow,
  so the stage copy names what is being waited on ("Waiting for Circle attestation") rather than
  showing a generic spinner.

Rejected alternative: CCTP Fast Transfer, which is near-instant but charges a fee — reintroducing
exactly the per-chain quoting problem this removes, to speed up something nobody is watching in
real time.

### 2026-07-28 — Simulator quotes fee-inclusively, with a worst-chain allowance

Settles the question left open earlier the same day. Every amount the Simulator shows is now a
**send** amount that carries a bridging allowance: `worst supported chain's fee + 20%`, currently
$1.20 (Arbitrum) + 20% = **$1.44**. Quick-select buttons read `$17.95 → 3y` where they used to read
`$16.51 → 3y`, and every result is solved from `budget − allowance` rather than `budget`.

**The bug this fixes was total, not marginal.** `payableThresholds()` rounds each tier up to the
next payable cent, so any fee above a cent drops the payment below the threshold. Checked across
every combination: all **9** tier/label-length pairs would have dropped a tier when sending the
quoted amount from Arbitrum — aim at the 6-year 43.75% rate on a 3-character name, land on 3-year
31.25%. After the change, **0 undershoots across 36 combinations** (3 lengths × 3 tiers × 4 chains),
verified against the real modules.

Why an allowance rather than the alternatives:

- **Worst chain, not per-chain.** A chain selector would be exactly correct for everyone and nobody
  would overpay, but it adds a control to a tool that currently asks the reader for nothing, and
  makes the headline number chain-dependent. Asking someone to look up their own chain and do the
  addition is the mistake this exists to prevent.
- **Overshooting is free**, which is what makes one-number-for-everyone viable. `solve()` buys the
  longest duration the money covers, so an Ethereum sender's surplus $1.44 comes back as extra time
  rather than being lost. The asymmetry is the whole argument: undershooting costs a *tier*.
- **20% of the fee, not a flat 20¢.** Volatility scales with the fee — mainnet gas spikes move it
  in absolute terms — so a proportional cushion tracks the risk. Circle give the same ~20% guidance
  for CCTP fees for the same reason.
- **A live quote can't be the safety mechanism**, only the displayed estimate. Fees move between
  render and send, and they move in the direction that hurts. `src/lib/fees.ts` is the seam where a
  real Across quote replaces the hardcoded table; the allowance stays either way.

Consequences worth knowing: the footnote changed from "These figures are before bridging fees" to
"Amounts include a bridging allowance", because the first became false. `Effective cost` is now
all-in (`send ÷ years`, $4.74/yr) rather than the ENS rate ($4.50/yr) — deliberate, since
"effective" means after everything, and the `Reaches renewal` row makes the difference visible.
The per-chain fee list under the buttons shows *raw* estimates, not buffered ones; it exists to
explain why the amounts are larger than the bare ENS thresholds, not to be added to them.

### 2026-07-28 — Renewal breakdown: three amounts, and demo data quoted fee-inclusively

`ActivityEvent.amount` became `amountDeposited` / `bridgeFee` / `amountApplied`, and `tx` (one hash)
became `steps: FlowStep[]`. The bridge takes its fee out of the amount in transit, so what bought
renewal time is genuinely less than what the funder sent, and collapsing that back to one number
would have hidden the gap.

The load-bearing call is in the seed data: **`AMOUNTS` is now the amount that gets *applied*, with
the fee added on top to reach the deposit** — a $16.50 renewal shows as $17.55 received on Base. The
alternative (treat the seeded value as the deposit and subtract) was tried in thinking and rejected:
every threshold in `AMOUNTS` is an exact tier boundary, so subtracting a fee drops all of them a
tier and the demo fills with near-misses that look like bugs rather than a feature tour.

That choice also amounts to modelling **fee-inclusive quoting** — the funder is assumed to have been
quoted an amount that survives the fee. It's the recommendation in `docs/ARCHITECTURE.md`, and this
is the first place the app takes a position on it, so flipping that decision means changing the
seed data too.

**Rows show both amounts when a fee was taken.** Caught during review: `seconds` and `off` are
correctly computed from `amountApplied` everywhere, but the row displayed only `amountDeposited`
beside them — so `$17.55 · 31.25% off · +3.0y` looked like an arithmetic error, since $17.55 at that
tier ($5.500007/yr for 5+ chars) implies +3.2y. Three numbers in one row, computed from two
different bases.

Rejected: showing only the applied amount (breaks the funder's own number and stops matching
`totalReceived` and the leaderboard) and leaving it to the expansion (the row still looks wrong at a
glance, and the live feed has no expansion at all). Settled on a muted `$16.50 applied` second line,
rendered by one shared `AmountCell` used in all four places rather than four near-copies. It
disappears for Ethereum-origin rows, which usefully doubles as a "no bridge here" signal.

**The aggregate tiles are deliberately *not* given the same treatment.** Proposed adding an
"applied" figure under "Total received" for consistency with the rows, and rejected: the two tiles
answer different questions. **Total received** is how much has ever arrived at the Namepass address
— the contribution total, which is also what the leaderboard ranks on. **Time delivered** is what
was actually bought in the ENS registry. Neither is derived from the other, so there is nothing to
reconcile and a fees line would only imply a relationship that isn't being claimed.

The row-level case was different, and that's the distinction to keep in mind: there, the amount, the
rate and the duration sit on one line and the last two *are* computed from the first, so showing a
pre-fee number beside them read as broken arithmetic. Independent tiles carry no such implication.

**Superseded on 2026-08-18:** `Total received` now sums `amount_received` from canonical `Renewed`
events. Deposit-event totals omit funds received before activation and manual balance recoveries.
The canonical renewal event records the exact amount received for both cases and cannot be counted
twice. Pending wallet funds remain in the separate pending balance section.

**The Simulator now says its figures are pre-fee**, since the ENS math it shows is exact but the
amount reaching that math isn't once a bridge takes its cut. First version spelled the whole thing
out inline and made the panel clunky; cut to one line with the detail behind the shared `Tooltip`,
which was extracted out of `PendingBalance.tsx` for the purpose rather than reimplemented — same
short-label-plus-explanation problem, so same component.

Smaller calls:

- **Aggregate tiles: values bottom-align via `flex-1` on the label, and the suffix is `y` not
  ` years`.** At three-up on a phone, "TIME DELIVERED" and "TOTAL RECEIVED" wrap to two lines while
  "RENEWALS" doesn't, so the values sat at three different heights; " years" wrapped too. Letting
  the label absorb the slack fixes the first, and the short suffix (already the convention in
  `fmtDuration`) fixes the second.
- **Fill and renewal are one step, not two.** The renewal rides Across's post-deposit hook, so it
  lands with the fill or reverts with it — showing them separately would imply a failure mode that
  can't happen. Cross-chain payments show 3 transactions, Ethereum-origin ones show 2.
- Reused the Leaderboard's accordion exactly (same `motion` props, same `ChevronDown` rotate) rather
  than writing a second expand animation — see the 2026-07-27 entry on approximating effects.
- Renamed the activity column "Amount" → "Received" in all four places it appears (desktop + mobile,
  live feed + name detail), since it's now specifically the pre-fee number.

### 2026-07-28 — Pending balance: allocation is the discriminator, not a status flag

The name card needed to distinguish "funds anyone can trigger" from "funds already moving," and the
obvious version — a status field on the balance — was rejected. Instead the split falls out of
`deposit_allocations`: `in_flight` is what an active flow has claimed, `held` is what's left.
Starting a flow allocates in the same transaction, so there's no window where money looks
triggerable while a flow owns it, and no second source of truth to drift.

Calls made alongside it:

- **One active flow per name** (unique partial index on non-terminal statuses). Guards the
  open-to-anyone trigger against double-spend races, and batches — mainnet gas gets paid once even
  when three people fund a name at the same moment. Consequence, accepted knowingly: funds arriving
  mid-flow *queue* rather than starting a second flow. An earlier sketch in the same conversation
  said held funds stayed triggerable during a flow; that contradicted the index and was wrong.
- **Auto-trigger threshold is a fee ratio (~15%), not a flat dollar floor.** $1 buys ~45 days on a
  5+ character name, ~2.3 days on a 4-character one, ~14 hours on a 3-character one, and the
  dominant cost is mainnet gas for the fill, which moves. A fixed floor is wrong in both directions
  and needs a config change every time gas spikes. (ENS has no minimum renewal duration — the
  28-day minimum is registration-only — so the constraint is purely economic.)
- **Hold reasons are stored, not inferred.** "The last attempt failed" and "the name can't be
  renewed yet" need different things from whoever is reading them, so they get different copy.
- **Short label inline, full sentence in the tooltip.** First pass put the same sentence in both and
  it read as a stutter.
- **No `unregistered` fixture in the demo data.** Tried it, and the card claimed the name wasn't
  registered directly beneath a panel reading "908 days of registration remaining." For the same
  reason, demo names seeded as un-renewable get their expiry pushed into the past so the panel above
  reads "Expired — needs renewal." The state is real on the backend; it just has no honest fixture
  here.
- `simulateRenewal()` skips un-renewable names — otherwise the live feed appended renewals to the
  name whose card said it was stuck in a premium auction.

### 2026-07-28 — Backend shape: CDP server wallets + Across intents with a post-deposit hook

> **Superseded 2026-07-29** by CREATE2 addresses and CCTP — see the entry at the top. Kept because
> the reasoning about atomicity, refund handling and why a durable orchestrator is needed still
> explains how the current design was arrived at.

Settled (not re-litigate territory). Each name's deposit address is a **CDP server wallet**, with
guardrails restricting what it can sign — its only job is signing an Across bridge intent. Across
intents carry a **post-deposit hook** that executes the ENS renewal on bridge settlement, so the
renewal isn't a separately orchestrated step we have to wait on and retry; it's part of the fill.
A separate API wallet pushes the transactions and sponsors gas. This flow is already proven in
another project of the author's; server wallets are in production use elsewhere (e.g. Bankr).

Consequences worth writing down:

- **This is custodial**, and that's accepted. Guardrails on the signer are the mitigation, not a
  claim of non-custody. See the correction on the "address, not agent" entry below.
- **No USDC→ETH swap step.** ENS v2 renewals are paid in stablecoins, so USDC goes end to end.
- **Failed Across bridges refund to the CDP wallet** — which re-triggers the deposit webhook. An
  inbound transfer is therefore *not* necessarily a user payment, and the ingestion layer has to
  classify it or the product double-counts its own refunds. This is the main reason the deposit
  ledger carries a `kind` discriminator.
- Rejected alternative (considered 2026-07-28, before the above was known): a durable
  multi-step saga — bridge, poll for attestation, swap, then renew — via Inngest/Trigger.dev.
  Unnecessary; the post-deposit hook collapses settlement and renewal into one atomic outcome.

### 2026-07-28 — Started this log instead of growing PRODUCT.md indefinitely

`PRODUCT.md`'s "positioning and tone" section was accumulating decision rationale as prose that
would need rewriting every time something new was decided. Splitting decisions out here means new
ones are appended, not edited-in. `PRODUCT.md` stays the current-state summary; this file is the
history of how it got that way.

---

### 2026-07-27 — Client-side routing is hand-rolled, not a router library

Four pages (home, leaderboard, terms, privacy), `history.pushState` + `popstate` is ~40 lines.
A router dependency would be more ceremony than the problem warrants at this size. Revisit if the
page count grows significantly or nested/dynamic routes show up.

### 2026-07-27 — Auto-review on every PR, not just `@claude` mentions

`.github/workflows/claude.yml` was originally mention-only (`@claude` in a comment/review/issue).
Changed to also trigger on `pull_request: [opened, synchronize]` per explicit request for
automatic review. Tradeoff accepted knowingly: this runs (and bills, against the user's Claude
subscription via `CLAUDE_CODE_OAUTH_TOKEN`) on *every* PR automatically, not just when asked.

### 2026-07-27 — `CLAUDE_CODE_OAUTH_TOKEN` over `ANTHROPIC_API_KEY` for CI

A plain API key from console.anthropic.com bills separately from the user's existing Claude
subscription. `claude setup-token` generates a long-lived (~1yr) OAuth token scoped to the
subscription instead. Tradeoff: the token is personal, tied to whoever ran `setup-token` — if that
person leaves/loses access, CI breaks. Acceptable for a solo-owned repo now; revisit (probably back
to an org-level API key) if this becomes a team repo.

### 2026-07-27 — Repo renamed `demo` → `namepass-v2`

No functional reason beyond naming clarity — flagging only because it required updating the local
git remote and any hardcoded clone URLs (README.md had one that went stale and was missed until
caught later — worth grepping for the old name if this ever needs doing again).

### 2026-07-27 — Deposit addresses are always shown in full, never truncated

Truncation hides the middle of an address, which is exactly where an address-swap/homograph attack
would land — a sender couldn't verify what they're actually paying. The ENS profile's *resolved*
address (informational, not a payment target) is still truncated elsewhere, since that tradeoff
doesn't apply the same way.

### 2026-07-27 — Leaderboard rows expand inline, not a separate page/route

Originally clicking a row navigated to that name's detail view on the Explorer page. Changed to an
inline accordion (chevron rotates, `PassCard` renders in place) per explicit request — keeps the
leaderboard self-contained rather than bouncing the user between pages for what's fundamentally a
"peek at this address" action.

### 2026-07-27 — The header lives inside `PageShell`, not above it

Tried a version where `Navbar` was a fixed/floating bar spanning all pages independent of page
content — rejected as looking like "a section bolted on top" rather than part of the page. Settled
on `PageShell` rendering `Navbar` as its first child on every route (video card on Home, white
card elsewhere), so the header is structurally part of whatever page it's on.

### 2026-07-27 — Reuse shine/shimmer effects exactly, don't approximate

Added a custom straight-line shimmer sweep to the Leaderboard button/toggle instead of reusing the
`ShineBorder`/`AnimatedShinyText` combo already established on the hero badge. Visually similar,
not identical — caught immediately. Standing rule now: "match X" means reuse the same
component/props, not a new implementation that looks similar.

### 2026-07-27 — Optimism excluded from supported chains

Appeared in mock/demo data (rotating chain preview, live activity feed) despite having no logo
asset and not being in the actual supported-chains list shown on `PassCard`. Removed everywhere —
`lib/registry.ts`'s chain pool, `Explorer.tsx`'s color/ping maps, `BottomLeftCard`'s rotation.
Chain support is Base, Arbitrum, Polygon, Ethereum only unless explicitly revisited.

### 2026-07-27 — Avoid the word "permanent" in user-facing copy

The underlying property (deposit address never changes) is genuinely permanent, but the word
itself was flagged for removal from copy — likely brand/liability-tone reasons, not stated
explicitly beyond "we want to avoid using the term 'permanent' anywhere on the app." Alternate
phrasing in use: "deposit address for name extensions," "auto renewal address," "never changes."

### 2026-07-27 — "Address," not "agent," as the primary framing

Considered leading with "Every name gets its own agent" instead of "Your name gets its own
address," since the real backend genuinely is agent-automated (CDP Agentic Wallets). Rejected:
for a security-conscious crypto audience, "agent" raises a custody question ("is the agent holding
my funds?") that "address" doesn't. Automation is still described, just as what happens *behind*
the address, not the headline noun.

> **Corrected 2026-07-28.** This entry originally justified the choice with "deterministic,
> non-custodial, no third party in the loop." That was never claimed by the project and was not
> true of the architecture at the time — CDP server wallets held keys and signed on our behalf.
> The decision here is about *which question the copy invites*, not about the custody model.
>
> **Update 2026-07-29.** Under CREATE2-derived addresses the original wording is now accurate.
> The framing was not retrofitted to the architecture — the architecture moved and the claim
> became true. See the CREATE2/CCTP entry at the top.
