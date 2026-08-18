import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { STABLE_TESTNET_CHAINS } from "../src/lib/chains.ts";

const outputPath = fileURLToPath(new URL("namepass-testnet.yaml", import.meta.url));
const webhookUrl = "https://demo-five-gray-37.vercel.app/api/webhooks/goldsky";
const chains = [...STABLE_TESTNET_CHAINS].sort(
	(a, b) => Number(Boolean(b.helperAddress)) - Number(Boolean(a.helperAddress)),
);
// This block predates the 2026-08-10 Sepolia deployment. It bounds replay and
// also versions the source when a downstream decoding rule needs a backfill.
const ethereumProtocolStartBlock = 11_450_000;

for (const chain of chains) {
	if (!chain.factoryAddress || !chain.usdcAddress || !chain.goldskyPrefix) {
		throw new Error(`${chain.network} is missing Goldsky configuration.`);
	}
}

const lower = (value) => value.toLowerCase();
const indent = (value, spaces) =>
	value
		.split("\n")
		.map((line) => `${" ".repeat(spaces)}${line}`)
		.join("\n");
const datasetVersion = (chain, kind) =>
	chain.key === "arc" ? "1.1.0" : kind === "erc20_transfers" ? "1.2.0" : "1.0.0";

function rawLogAddresses(chain) {
	if (chain.helperAddress) {
		if (!chain.ensRegistrarAddress || !chain.ensRenewerV1Address || !chain.ensReferrer) {
			throw new Error(`${chain.network} is missing ENS addresses.`);
		}
		return [
			chain.factoryAddress,
			chain.helperAddress,
			chain.ensRegistrarAddress,
			chain.ensRenewerV1Address,
		];
	}
	return [chain.factoryAddress];
}

function renderSources() {
	return chains
		.flatMap((chain) => {
			const addresses = rawLogAddresses(chain)
				.map((address) => `'${lower(address)}'`)
				.join(",\n      ");
			const logBlockFilter = chain.key === "ethereum"
				? ` AND block_number >= ${ethereumProtocolStartBlock}`
				: "";
			const sources = [
				`${chain.goldskyPrefix}_usdc:
  type: dataset
  dataset_name: ${chain.goldskyPrefix}.erc20_transfers
  version: ${datasetVersion(chain, "erc20_transfers")}
  start_at: latest
  filter: >-
    address = '${lower(chain.usdcAddress)}'`,
			];
			if (chain.key === "arc") {
				sources.push(`${chain.goldskyPrefix}_native_usdc:
  type: dataset
  dataset_name: ${chain.goldskyPrefix}.receipt_transactions
  version: 1.0.0
  start_at: latest
  filter: >-
    receipt_status = 1
    AND to_address IS NOT NULL`);
			}
			sources.push(`${chain.goldskyPrefix}_logs:
  type: dataset
  dataset_name: ${chain.goldskyPrefix}.raw_logs
  version: ${datasetVersion(chain, "raw_logs")}
  # Contract-address filters make replay bounded by deployment history. Replaying
  # prevents a pipeline recreation from permanently losing earlier renewals.
  start_at: earliest
  filter: >-
    address IN (
      ${addresses}
    )${logBlockFilter}`);
			return sources;
		})
		.map((source) => indent(source, 2))
		.join("\n\n");
}

function renderUnion(select) {
	return chains.map(select).join("\nUNION ALL\n");
}

function addressPredicate(column, addresses) {
	const values = [...new Set(addresses.map(lower))];
	if (values.length === 1) return `${column} = '${values[0]}'`;
	return `${column} IN (${values.map((address) => `'${address}'`).join(", ")})`;
}

const erc20TransferUnion = renderUnion(
	(chain) => `SELECT
  concat('${chain.chainId}:', id) AS event_id,
  'deposit' AS event_family,
  'Transfer' AS event_type,
  ${chain.chainId} AS chain_id,
  block_number,
  block_timestamp AS block_time,
  transaction_hash AS tx_hash,
  log_index,
  lower(address) AS token_address,
  lower(sender) AS sender_address,
  lower(recipient) AS recipient_address,
  CAST(amount AS STRING) AS amount,
  _gs_op
FROM ${chain.goldskyPrefix}_usdc`,
);

const arc = chains.find((chain) => chain.key === "arc");
if (!arc) throw new Error("The stable testnet registry has no Arc chain.");
const arcNativeTransfer = `SELECT
  concat('${arc.chainId}:native:', id) AS event_id,
  'deposit' AS event_family,
  'Transfer' AS event_type,
  ${arc.chainId} AS chain_id,
  block_number,
  block_timestamp AS block_time,
  hash AS tx_hash,
  transaction_index AS log_index,
  '${lower(arc.usdcAddress)}' AS token_address,
  lower(from_address) AS sender_address,
  lower(to_address) AS recipient_address,
  u256_to_string(to_u256(value) / to_u256('1000000000000')) AS amount,
  _gs_op
FROM ${arc.goldskyPrefix}_native_usdc
WHERE to_u256(value) >= to_u256('1000000000000')
  AND to_u256(value) % to_u256('1000000000000') = to_u256('0')`;
const transferUnion = `${erc20TransferUnion}\nUNION ALL\n${arcNativeTransfer}`;

const rawLogsUnion = renderUnion(
	(chain) => `SELECT
  concat('${chain.chainId}:', id) AS event_id,
  ${chain.chainId} AS chain_id,
  block_number,
  block_timestamp AS block_time,
  transaction_hash AS tx_hash,
  log_index,
  lower(address) AS contract_address,
  topics,
  \`data\`,
  _gs_op
FROM ${chain.goldskyPrefix}_logs`,
);

const eventAbi = JSON.stringify([
	{
		anonymous: false,
		inputs: [
			{ indexed: true, name: "labelKey", type: "bytes32" },
			{ indexed: true, name: "wallet", type: "address" },
			{ indexed: false, name: "label", type: "string" },
		],
		name: "WalletDeployed",
		type: "event",
	},
	{
		anonymous: false,
		inputs: [
			{ indexed: true, name: "labelKey", type: "bytes32" },
			{ indexed: true, name: "wallet", type: "address" },
			{ indexed: false, name: "amount", type: "uint256" },
			{ indexed: false, name: "remaining", type: "uint256" },
		],
		name: "DepositProcessed",
		type: "event",
	},
	{
		anonymous: false,
		inputs: [
			{ indexed: true, name: "nonce", type: "bytes32" },
			{ indexed: true, name: "wallet", type: "address" },
			{ indexed: false, name: "sourceDomain", type: "uint32" },
			{ indexed: false, name: "burnAmount", type: "uint256" },
			{ indexed: false, name: "feeExecuted", type: "uint256" },
			{ indexed: false, name: "mintedAmount", type: "uint256" },
		],
		name: "CCTPClaimed",
		type: "event",
	},
	{
		anonymous: false,
		inputs: [
			{ indexed: true, name: "labelHash", type: "bytes32" },
			{ indexed: true, name: "wallet", type: "address" },
			{ indexed: true, name: "executor", type: "address" },
			{ indexed: false, name: "label", type: "string" },
			{ indexed: false, name: "duration", type: "uint64" },
			{ indexed: false, name: "amountReceived", type: "uint256" },
			{ indexed: false, name: "gasAllowance", type: "uint256" },
			{ indexed: false, name: "amountApplied", type: "uint256" },
			{ indexed: false, name: "remainder", type: "uint256" },
			{ indexed: false, name: "fromCCTP", type: "bool" },
		],
		name: "Renewed",
		type: "event",
	},
	{
		anonymous: false,
		inputs: [
			{ indexed: true, name: "tokenId", type: "uint256" },
			{ indexed: false, name: "label", type: "string" },
			{ indexed: false, name: "duration", type: "uint64" },
			{ indexed: false, name: "newExpiry", type: "uint64" },
			{ indexed: false, name: "paymentToken", type: "address" },
			{ indexed: true, name: "referrer", type: "bytes32" },
			{ indexed: false, name: "amount", type: "uint256" },
		],
		name: "NameRenewed",
		type: "event",
	},
]);

const hub = chains.find((chain) => chain.helperAddress);
if (!hub) throw new Error("The stable testnet registry has no hub chain.");
const factoryPredicate = addressPredicate(
	"contract_address",
	chains.map((chain) => chain.factoryAddress),
);
const sinks = [
	["deposits_webhook", "incoming_deposits"],
	["wallet_deployed_webhook", "wallet_deployed"],
	["deposit_processed_webhook", "deposit_processed"],
	["cctp_claimed_webhook", "cctp_claimed"],
	["renewed_webhook", "renewed"],
	["ens_name_renewed_webhook", "ens_name_renewed"],
]
	.map(
		([name, from]) => `  ${name}:
    type: webhook
    from: ${from}
    url: ${webhookUrl}
    secret_name: NAMEPASS_TESTNET_WEBHOOK_AUTH
    one_row_per_request: true`,
	)
	.join("\n\n");

function render() {
	return `# Generated by goldsky/generate-testnet.mjs. Do not edit.
name: namepass-testnet
apiVersion: 3
resource_size: s
description: Detect Namepass testnet deposits and protocol events.

sources:
${renderSources()}

transforms:
  watched_addresses:
    type: dynamic_table
    backend_type: Postgres
    backend_entity_name: watched_addresses
    schema: goldsky
    column: value
    time_column: updated_at
    secret_name: NAMEPASS_GOLDSKY_READER

  all_usdc_transfers:
    type: sql
    primary_key: event_id
    sql: |
${indent(transferUnion, 6)}

  incoming_deposits:
    type: sql
    primary_key: event_id
    sql: |
      SELECT *
      FROM all_usdc_transfers
      WHERE dynamic_table_check('watched_addresses', recipient_address)

  all_raw_logs:
    type: sql
    primary_key: event_id
    sql: |
${indent(rawLogsUnion, 6)}

  decoded_logs:
    type: sql
    primary_key: event_id
    sql: |
      SELECT
        event_id,
        chain_id,
        block_number,
        block_time,
        tx_hash,
        log_index,
        contract_address,
        _gs_log_decode(
          '${eventAbi}',
          topics,
          \`data\`
        ) AS \`decoded\`,
        _gs_op
      FROM all_raw_logs

  wallet_deployed:
    type: sql
    primary_key: event_id
    sql: |
      SELECT
        event_id,
        'namepass' AS event_family,
        'WalletDeployed' AS event_type,
        chain_id,
        block_number,
        block_time,
        tx_hash,
        log_index,
        contract_address,
        decoded.event_params[1] AS label_key,
        lower(decoded.event_params[2]) AS wallet_address,
        decoded.event_params[3] AS label,
        _gs_op
      FROM decoded_logs
      WHERE decoded.event_signature = 'WalletDeployed'
        AND ${factoryPredicate}

  deposit_processed:
    type: sql
    primary_key: event_id
    sql: |
      SELECT
        event_id,
        'namepass' AS event_family,
        'DepositProcessed' AS event_type,
        chain_id,
        block_number,
        block_time,
        tx_hash,
        log_index,
        contract_address,
        decoded.event_params[1] AS label_key,
        lower(decoded.event_params[2]) AS wallet_address,
        decoded.event_params[3] AS amount,
        decoded.event_params[4] AS remaining_amount,
        _gs_op
      FROM decoded_logs
      WHERE decoded.event_signature = 'DepositProcessed'
        AND ${factoryPredicate}

  cctp_claimed:
    type: sql
    primary_key: event_id
    sql: |
      SELECT
        event_id,
        'namepass' AS event_family,
        'CCTPClaimed' AS event_type,
        chain_id,
        block_number,
        block_time,
        tx_hash,
        log_index,
        contract_address,
        decoded.event_params[1] AS nonce,
        lower(decoded.event_params[2]) AS wallet_address,
        decoded.event_params[3] AS source_domain,
        decoded.event_params[4] AS burn_amount,
        decoded.event_params[5] AS fee_executed,
        decoded.event_params[6] AS minted_amount,
        _gs_op
      FROM decoded_logs
      WHERE decoded.event_signature = 'CCTPClaimed'
        AND contract_address = '${lower(hub.helperAddress)}'

  renewed:
    type: sql
    primary_key: event_id
    sql: |
      SELECT
        event_id,
        'namepass' AS event_family,
        'Renewed' AS event_type,
        chain_id,
        block_number,
        block_time,
        tx_hash,
        log_index,
        contract_address,
        decoded.event_params[1] AS label_hash,
        lower(decoded.event_params[2]) AS wallet_address,
        lower(decoded.event_params[3]) AS executor_address,
        decoded.event_params[4] AS label,
        decoded.event_params[5] AS duration,
        decoded.event_params[6] AS amount_received,
        decoded.event_params[7] AS gas_allowance,
        decoded.event_params[8] AS amount_applied,
        decoded.event_params[9] AS remainder,
        decoded.event_params[10] AS from_cctp,
        _gs_op
      FROM decoded_logs
      WHERE decoded.event_signature = 'Renewed'
        AND contract_address = '${lower(hub.helperAddress)}'

  ens_name_renewed:
    type: sql
    primary_key: event_id
    sql: |
      SELECT
        ens.event_id,
        'ens' AS event_family,
        'NameRenewed' AS event_type,
        ens.chain_id,
        ens.block_number,
        ens.block_time,
        ens.tx_hash,
        ens.log_index,
        ens.contract_address,
        ens.decoded.event_params[1] AS token_id,
        ens.decoded.event_params[2] AS label,
        ens.decoded.event_params[3] AS duration,
        ens.decoded.event_params[4] AS new_expiry,
        lower(ens.decoded.event_params[5]) AS payment_token,
        ens.decoded.event_params[6] AS referrer,
        ens.decoded.event_params[7] AS amount,
        ens._gs_op
      FROM decoded_logs AS ens
      WHERE ens.decoded.event_signature = 'NameRenewed'
        AND ens.decoded.event_params[6] IN (
          '${lower(hub.ensReferrer)}',
          '${lower(hub.ensReferrer).slice(2)}'
        )
        AND ens.contract_address IN (
          '${lower(hub.ensRegistrarAddress)}',
          '${lower(hub.ensRenewerV1Address)}'
        )

sinks:
${sinks}
`;
}

const generated = render();
if (process.argv.includes("--check")) {
	if (readFileSync(outputPath, "utf8") !== generated) {
		console.error("goldsky/namepass-testnet.yaml is stale. Run node goldsky/generate-testnet.mjs.");
		process.exitCode = 1;
	} else {
		console.log("Checked goldsky/namepass-testnet.yaml.");
	}
} else {
	writeFileSync(outputPath, generated);
	console.log("Generated goldsky/namepass-testnet.yaml.");
}
