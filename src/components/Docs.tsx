import { useEffect, useState, type ReactNode } from "react";
import { ArrowDownToLine, Copy, Check } from "lucide-react";

type Operation = {
	summary: string;
	description: string;
	parameters?: Array<{ name: string; in: string; required?: boolean }>;
	requestBody?: { content: Record<string, { schema: unknown }> };
	responses: Record<string, unknown>;
};
type Spec = { paths: Record<string, Record<string, Operation>> };
const sections = [
	["quickstart", "Quickstart"],
	["addresses", "Activation & addresses"],
	["quotes", "Funding estimates"],
	["transfers", "Report a transfer"],
	["settlement", "Settlement & pooled funds"],
	["sync", "Sync & replay"],
	["webhooks", "Webhooks"],
	["recovery", "Recovery"],
	["contract", "API conventions"],
	["reference", "API reference"],
	["release", "Release & support"],
];
function Code({ children }: { children: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<div className="relative my-5 rounded-xl bg-[#10291c] text-[#d7efdf]">
			<button
				aria-label="Copy code"
				className="absolute right-3 top-3 rounded p-2 hover:bg-white/10"
				onClick={() =>
					void navigator.clipboard.writeText(children).then(() => {
						setCopied(true);
						setTimeout(() => setCopied(false), 1500);
					})
				}
			>
				{copied ? <Check size={15} /> : <Copy size={15} />}
			</button>
			<pre className="overflow-x-auto p-5 pr-14 text-[12px] leading-6">
				<code>{children}</code>
			</pre>
		</div>
	);
}
function Section({
	id,
	title,
	children,
}: {
	id: string;
	title: string;
	children: ReactNode;
}) {
	return (
		<section id={id} className="scroll-mt-8 border-t border-black/10 pt-8 pb-6">
			<h2 className="mb-4 text-[25px] tracking-tight">{title}</h2>
			<div className="space-y-4 text-[15px] leading-7 text-ink-secondary">
				{children}
			</div>
		</section>
	);
}
export default function Docs() {
	const [spec, setSpec] = useState<Spec | null>(null);
	useEffect(() => {
		let live = true;
		void fetch("/openapi.json")
			.then((r) => (r.ok ? r.json() : Promise.reject()))
			.then((s) => {
				if (live) setSpec(s);
			})
			.catch(() => {});
		return () => {
			live = false;
		};
	}, []);
	return (
		<div className="mx-auto w-full max-w-[1240px] px-6 pb-20 md:px-12">
			<header className="py-10 md:py-16">
				<p className="mb-5 text-xs uppercase tracking-[.18em] text-ink-secondary">
					Namepass · Developer documentation
				</p>
				<h1 className="max-w-3xl text-[40px] leading-[1.1] tracking-tight md:text-[64px]">
					Bring ENS renewals
					<br />
					into your application.
				</h1>
				<p className="mt-6 max-w-2xl text-lg leading-8 text-ink-secondary">
					Activate a universal deposit address. Report a USDC transfer. Follow
					verified consumption and final ENS settlement through one durable API.
				</p>
				<div className="mt-6 flex flex-wrap items-center gap-4 text-xs">
					<span className="rounded-full bg-[#e8f2eb] px-3 py-1.5">
						Testnet · API 2026-09-28
					</span>
					<a
						className="inline-flex items-center gap-2 underline underline-offset-4"
						href="/openapi.json"
						download
					>
						<ArrowDownToLine size={14} />
						OpenAPI 3.1
					</a>
				</div>
			</header>
			<div className="grid gap-10 lg:grid-cols-[190px_minmax(0,1fr)]">
				<aside>
					<nav
						aria-label="Documentation sections"
						className="flex flex-wrap gap-x-5 gap-y-3 text-sm lg:sticky lg:top-8 lg:flex-col"
					>
						{sections.map(([id, label]) => (
							<a
								className="text-ink-secondary hover:text-ink-primary"
								href={"#" + id}
								key={id}
							>
								{label}
							</a>
						))}
					</nav>
				</aside>
				<article className="min-w-0">
					<Section id="quickstart" title="A bank integration in five steps">
						<ol className="list-decimal space-y-2 pl-5">
							<li>
								Obtain a scoped server-side API key from your Namepass operator.
							</li>
							<li>
								Activate the ENS name and wait for initialization to finish.
							</li>
							<li>
								Send supported USDC to the returned address using your existing
								payment system.
							</li>
							<li>
								Register the transaction hash and your private transfer
								reference.
							</li>
							<li>
								Consume webhooks or the event feed. Mark the customer transfer
								complete only after consumption is proven and all candidate
								renewals are finalized.
							</li>
						</ol>
						<Code>{`# Keep the key on your server. Read GET /config first.
export NAMEPASS_API="https://your-deployment.example/api/v1"
curl "$NAMEPASS_API/names/activate" \\
  -H "Authorization: Bearer $NAMEPASS_API_KEY" \\
  -H 'Content-Type: application/json' \\
  -H 'Idempotency-Key: customer-42-activate-alice' \\
  -d '{"name":"alice.eth"}'`}</Code>
						<p>
							An initialization response is <code>202</code> with{" "}
							<code>operationId</code>, <code>nameId</code>, the full{" "}
							<code>depositAddress</code> and the alias. Poll{" "}
							<code>GET /activations/&#123;id&#125;</code> or follow{" "}
							<code>activation.updated</code>. Publication is asynchronous; a
							newly returned ID can briefly be unavailable in the read
							projection. Retry with backoff.
						</p>
					</Section>
					<Section id="addresses" title="Activation and deposit addresses">
						<p>
							The same ENS label derives the same deposit address on the
							supported chains in this deployment. Always use the chain and
							token addresses from <code>GET /config</code>. A watch is a
							subscription to public name activity; it does not establish
							ownership of the ENS name or a deposit.
						</p>
						<p>
							The alias has the form <code>alice.namepass.eth</code>. Its
							resolution chain is Ethereum mainnet, even for the current testnet
							payment deployment. Only use alias resolution when{" "}
							<code>config.alias.verified</code> is true and the resolved
							address matches the returned full deposit address. Activation can
							return an address before history repair finishes.
						</p>
						<p>
							<code>GET /names/&#123;name&#125;</code> reads stored state
							without making RPC calls or starting renewals. Its balances are
							block-tagged snapshots, not spendable balance promises. Native Arc
							discovery has a separate bounded activation range in the coverage
							fields; later native transfers are discovered by the live indexer
							or exact transaction registration. <code>historyCoverage</code>{" "}
							gives explicit per-chain block ranges. A balance snapshot does not
							recover historical senders. Use{" "}
							<code>POST /names/&#123;name&#125;/refresh</code> to request a new
							scan.
						</p>
						<p>
							ERC-20 USDC transfers are supported on every configured chain. Arc
							additionally supports top-level native USDC transfers: native
							value uses 18 decimals and must convert exactly to six-decimal
							USDC. Internal native transfers are outside this funding contract.
						</p>
					</Section>
					<Section id="quotes" title="Quote before funding">
						<p>
							<code>POST /quotes</code> accepts a name, chain ID and amount in
							micro-USDC. It reads the selected ENS helper and its quote at one
							verified hub block. Quotes expire after 60 seconds. They are
							estimates for one renewal flow with standard CCTP, unchanged
							pricing and no existing wallet balance.
						</p>
						<Code>{`{"name":"alice.eth","chainId":"84532","amount":"10000000"}`}</Code>
						<p>
							Keep arithmetic in integers. Ten USDC is <code>"10000000"</code>.
							Fees are charged per renewal flow; pooled deposits share the
							result. A quote is not a payment instruction, reservation, or
							settlement guarantee.
						</p>
					</Section>
					<Section
						id="transfers"
						title="Give each bank transfer a durable identity"
					>
						<Code>{`curl "$NAMEPASS_API/transfers" \\
  -H "Authorization: Bearer $NAMEPASS_API_KEY" \\
  -H 'Content-Type: application/json' \\
  -H 'Idempotency-Key: bank-transfer-1001' \\
  -d '{
    "name":"alice.eth",
    "chainId":"84532",
    "txHash":"0x…64 hexadecimal characters…",
    "transferKind":"erc20",
    "reference":"bank-transfer-1001"
  }'`}</Code>
						<p>
							Keep the returned <code>transferId</code>. The reference is
							private to your integration and remains unique beyond the
							seven-day idempotency window. A report is accepted before mining
							or indexing. Namepass verifies chain identity, successful receipt,
							recipient, token, value and the canonical block.
						</p>
						<p>
							If one receipt contains several matching transfers, the result
							becomes <code>selection_required</code>. Submit the chosen{" "}
							<code>logIndex</code> to{" "}
							<code>POST /transfers/&#123;id&#125;/transactions</code>. Use that
							same endpoint for replacement hashes. One bank transfer must not
							silently become several mined payments. Native Arc uses{" "}
							<code>transferKind: "native"</code> without a log index.
						</p>
						<p>
							Transfer statuses are <code>reported</code>,{" "}
							<code>selection_required</code>, <code>verified</code>,{" "}
							<code>rejected</code>, <code>orphaned</code> and{" "}
							<code>completed</code>. Verified means the deposit receipt is
							valid. Completed means the conservative consumption rule below has
							passed. A missing receipt stays pending; it is not a failed
							payment.
						</p>
					</Section>
					<Section id="settlement" title="Know what completed means">
						<div className="overflow-x-auto">
							<table className="w-full text-left text-sm">
								<thead>
									<tr className="border-b">
										<th className="py-3 pr-4">Fact</th>
										<th>What it proves</th>
									</tr>
								</thead>
								<tbody>
									{[
										[
											"Deposit verified",
											"The exact transfer occurred in a successful canonical receipt.",
										],
										[
											"Consumption consumed",
											"A verified full drain and complete processing coverage prove the funds left the source wallet.",
										],
										[
											"Flow settled",
											"The selected Namepass renewal receipt has been verified.",
										],
										[
											"Settlement observed",
											"The gateway and ENS receipt prove the renewal and its exact amounts.",
										],
										[
											"Settlement finalized",
											"The hub block is canonical and at or below the finalized head.",
										],
										[
											"Transfer completed",
											"Consumption is proven and every candidate settlement is finalized.",
										],
									].map(([a, b]) => (
										<tr className="border-b border-black/5" key={a}>
											<td className="py-3 pr-5 align-top font-medium text-ink-primary">
												{a}
											</td>
											<td className="py-3">{b}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
						<p>
							For example, deposits of 3 and 7 USDC can fund one 10 USDC
							renewal. Both deposits reference the same flow totals. Neither
							receives an invented share of renewal time. If a wallet is
							processed in slices, every subsequent flow that could have
							consumed the deposit remains a candidate until a full drain is
							verified. Completion waits for all those renewals.
						</p>
						<p>
							Read <code>amountProcessed</code>, <code>bridgeFee</code>,{" "}
							<code>amountReceivedOnHub</code>, <code>executorAllowance</code>,{" "}
							<code>amountApplied</code>, <code>roundingResidue</code> and{" "}
							<code>originWalletRemainder</code> separately. The gateway retains
							rounding residue. It is not a refundable source-wallet balance.
							Per-deposit allocations remain unknown for pooled funds.
						</p>
						<p>
							Source finality, Circle attestation and hub finality are different
							facts. Reorgs produce new resource versions and can invalidate
							settlement evidence. Persist revisions and correction events; do
							not infer finality from the legacy deposit observation status or
							elapsed time.
						</p>
					</Section>
					<Section id="sync" title="Bootstrap once. Resume by cursor.">
						<p>
							A timestamp is useful for an initial history query. It is unsafe
							as your ongoing checkpoint: a transfer created yesterday can
							settle today, and independent database transactions can commit out
							of order.
						</p>
						<ol className="list-decimal space-y-2 pl-5">
							<li>
								Create the desired watches, then call <code>POST /sync</code>.
							</li>
							<li>
								Save its snapshot ID and <code>eventsCursor</code>.
							</li>
							<li>
								Page <code>GET /sync/&#123;id&#125;</code> until{" "}
								<code>hasMore</code> is false. Replace your local resources
								using their IDs and versions.
							</li>
							<li>
								Poll <code>GET /events?cursor=…</code> from that saved event
								cursor.
							</li>
							<li>
								Commit each batch and its returned <code>nextCursor</code>{" "}
								together in your database.
							</li>
						</ol>
						<p>
							The snapshot freezes state at one published position and lasts 24
							hours. Later commits appear after the saved event cursor,
							including transactions that started earlier. Resource lists also
							freeze a position while paging. Do not change filters mid-page.
							Adding a new watch requires another snapshot for that scope.
						</p>
						<p>
							Events are retained for 90 days.{" "}
							<code>GET /events?from=2026-09-28T00:00:00Z</code> uses inclusive
							publication time. Switch to the returned cursor after the first
							page. A <code>410</code> means you must create a fresh snapshot.
							Canonical resource history remains subject to the deployment’s
							evidence coverage.
						</p>
					</Section>
					<Section id="webhooks" title="Signed notifications, with replay">
						<p>
							Create an endpoint with <code>POST /webhook-endpoints</code>.
							Store the one-time <code>signingSecret</code>, then call{" "}
							<code>POST /webhook-endpoints/&#123;id&#125;/verify</code>. The
							endpoint becomes active after your server accepts its signed{" "}
							<code>endpoint.verification</code> event. Empty{" "}
							<code>eventTypes</code> subscribes to all eligible events.
						</p>
						<p>
							Verify the Standard Webhooks headers <code>webhook-id</code>,{" "}
							<code>webhook-timestamp</code> and <code>webhook-signature</code>{" "}
							against the exact raw body before parsing JSON. The signed value
							is <code>id.timestamp.body</code>, authenticated with HMAC-SHA256
							and the base64-decoded secret after <code>whsec_</code>. Accept
							timestamps within five minutes and compare signatures in constant
							time.
						</p>
						<p>
							Persist the event and deduplication ID before returning{" "}
							<code>2xx</code>; process it asynchronously. Delivery is at least
							once and may arrive out of order. Upsert only newer resource
							versions. The replay feed is the recovery authority. During secret
							rotation, deliveries carry both signatures for 24 hours.
						</p>
						<p>
							Attempts time out after 20 seconds. Network failures,{" "}
							<code>408</code>, <code>429</code> and <code>5xx</code> retry with
							delays of 10 seconds, 1 minute, 5 minutes, 30 minutes, 2 hours and
							then 6 hours, within 72 hours. Other <code>4xx</code> and
							redirects pause the delivery. Public HTTPS on port 443 is
							required; private destinations, redirects and DNS rebinding are
							blocked.
						</p>
						<p>
							Inspect <code>/webhook-deliveries</code>, test an endpoint, rotate
							its secret, or replay an original event. Editing an endpoint
							pauses pending deliveries from its previous configuration. Replay
							is explicit after the destination is verified. Test and
							verification events must never be treated as customer settlements.
						</p>
					</Section>
					<Section id="recovery" title="Recover without sending twice">
						<p>
							A held flow means funds can still be at the source wallet.{" "}
							<code>unclaimed</code> means a source burn needs its existing
							Circle message completed. A failed or cancelled execution does not
							prove a refund. Follow the reason code and evidence before taking
							action.
						</p>
						<p>
							<code>POST /flows/&#123;id&#125;/retry</code> revalidates and
							resumes that same safe flow. It does not ask the bank to send
							another payment. Unsupported recovery returns a conflict and needs
							operator reconciliation. If a flow was absorbed or merged, its
							lookup remains available with <code>supersededBy</code>.
						</p>
						<p>
							For receiver outages, resume from the last committed event cursor.
							For missed indexing, report the exact transaction hash. For older
							transactions, archive receipt availability determines recovery
							coverage. Keep the transfer unresolved when evidence is
							incomplete.
						</p>
					</Section>
					<Section id="contract" title="API conventions">
						<ul className="list-disc space-y-2 pl-5">
							<li>
								Keep API keys on your backend. Scopes are <code>read</code>,{" "}
								<code>names:write</code>, <code>transfers:write</code>,{" "}
								<code>flows:retry</code> and <code>webhooks:manage</code>.
							</li>
							<li>
								All creation and action writes require{" "}
								<code>Idempotency-Key</code>, except read-only quotes and
								snapshot creation. Reuse the exact body. Different bodies with
								the same key return <code>409</code>.
							</li>
							<li>
								Amounts, chain IDs, block numbers and resource versions use
								decimal strings. Resource versions may skip numbers. JSON bodies
								are limited to 8 KiB.
							</li>
							<li>
								Default limits are 10 reads/second (burst 20), 60 writes/minute
								and 10 activation, refresh or quote requests/minute. Honor{" "}
								<code>Retry-After</code> on <code>429</code>.
							</li>
							<li>
								Pages default to 50 items and allow at most 100. Cursors are
								opaque and bound to your partner, deployment and query.
							</li>
							<li>
								Errors contain <code>error.code</code>,{" "}
								<code>error.message</code> and <code>requestId</code>. Include
								the request ID when asking the operator for help.
							</li>
							<li>
								Read projections and notifications are asynchronous. Do not
								interpret temporary absence immediately after a write as
								rejection.
							</li>
						</ul>
					</Section>
					<Section id="reference" title="API reference">
						<p>
							The downloadable OpenAPI file is the machine-readable contract.
							Its generated TypeScript types and runnable server examples are in
							the repository under{" "}
							<code>src/lib/integration-api.generated.ts</code> and{" "}
							<code>examples/integration</code>.
						</p>
						{spec ? (
							Object.entries(spec.paths).map(([path, methods]) => (
								<div key={path} className="rounded-xl border border-black/10">
									{Object.entries(methods).map(([method, operation]) => (
										<details
											key={method}
											className="border-b border-black/5 last:border-0"
										>
											<summary className="cursor-pointer px-4 py-4 text-sm">
												<span className="mr-3 inline-block w-14 font-mono text-xs font-semibold text-[#246242]">
													{method.toUpperCase()}
												</span>
												<code className="break-all text-ink-primary">
													{path}
												</code>
												<span className="mt-1 block text-xs lg:ml-[68px]">
													{operation.summary}
												</span>
											</summary>
											<div className="px-5 pb-5">
												<p className="text-sm">
													{operation.description.replace(/`/g, "")}
												</p>
												{!!operation.parameters?.length && (
													<p className="text-xs">
														Parameters:{" "}
														{operation.parameters
															.map(
																(p) =>
																	`${p.name} (${p.in}${p.required ? ", required" : ""})`,
															)
															.join("; ")}
														.
													</p>
												)}
												{operation.requestBody && (
													<Code>
														{JSON.stringify(
															operation.requestBody.content["application/json"]
																.schema,
															null,
															2,
														)}
													</Code>
												)}
											</div>
										</details>
									))}
								</div>
							))
						) : (
							<p>
								Download{" "}
								<a className="underline" href="/openapi.json">
									the OpenAPI reference
								</a>{" "}
								to inspect every operation.
							</p>
						)}
					</Section>
					<Section id="release" title="Release and support">
						<p>
							This version targets the configured testnet deployment. API access
							is enabled by the operator after migration, configuration,
							archive/finality provider checks and signed canary verification.
							The docs being available does not imply that mainnet payments or
							API access are enabled.
						</p>
						<p>
							Version <code>2026-09-28</code> introduces partner scopes, durable
							transfer references, exact settlement evidence, consistent
							snapshots, replay, signed webhooks and recovery controls. Additive
							fields may appear without changing the version; clients should
							ignore unknown response fields. Breaking changes require a new
							contract version.
						</p>
						<p>
							Contact your Namepass operator with the request ID, deployment ID,
							transfer ID and transaction hash. Do not send API keys, signing
							secrets or signed transaction bytes.
						</p>
					</Section>
				</article>
			</div>
		</div>
	);
}
