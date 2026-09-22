import { readFileSync, writeFileSync } from "node:fs";

// Publishes contract compiler inputs only. No environment files or wallet keys are read.
const [manifestPath, reportPath, mode = "status"] = process.argv.slice(2);
if (!manifestPath || !reportPath || !["submit", "status"].includes(mode)) throw new Error("Usage: node verify-source.mjs MANIFEST REPORT [submit|status]");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const bundle = JSON.parse(readFileSync(new URL("./generated/bundle.json", import.meta.url), "utf8"));
if (manifest.artifactFingerprint !== bundle.fingerprint) throw new Error("Artifact fingerprint differs");
let report = { checkedAt: new Date().toISOString(), provider: "Sourcify v2", contracts: [] };
try { report = JSON.parse(readFileSync(reportPath, "utf8")); } catch (e) { if (e.code !== "ENOENT") throw e; }
const save = () => { report.checkedAt = new Date().toISOString(); writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n"); };
async function request(path, body) {
  const response = await fetch(`https://sourcify.dev/server${path}`, {
    method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60_000),
  });
  const result = await response.json();
  return { httpStatus: response.status, ...result };
}
for (const [id, tx] of Object.entries(manifest.journal).filter(([id]) => id.startsWith("deploy-"))) {
  const name = id.split("-")[1], address = manifest.contracts[name].address;
  let entry = report.contracts.find(item => item.id === id);
  if (!entry) { entry = { id, name, chainId: tx.chainId, address }; report.contracts.push(entry); }
  try {
    entry.lookup = await request(`/v2/contract/${tx.chainId}/${address}`);
    if (mode === "submit" && !entry.lookup.runtimeMatch && !entry.submission?.verificationId) {
      const artifact = bundle.contracts[name];
      entry.submission = await request(`/v2/verify/${tx.chainId}/${address}`, {
        stdJsonInput: artifact.standardInput, compilerVersion: artifact.compiler,
        contractIdentifier: `${artifact.source}:${name}`, creationTransactionHash: tx.hash,
      });
    }
    if (entry.submission?.verificationId) entry.job = await request(`/v2/verify/${entry.submission.verificationId}`);
    delete entry.error;
  } catch (error) { entry.error = error.message; }
  save();
  console.log(`${id}: ${JSON.stringify({ match: entry.lookup?.match, submission: entry.submission, job: entry.job, error: entry.error })}`);
}
