import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { keccak256, stringToHex } from "viem";

const root = fileURLToPath(new URL("../../", import.meta.url));
// TimelockController is imported by the tests. Include it in the artifact build.
execFileSync("forge", ["build", "--ast", "--force", "-q"], { cwd: root, stdio: "inherit" });
const contracts = {};
for (const name of ["NamepassFactory", "TimelockController", "RenewalHelperPointer", "NamepassL1Gateway", "ENSV2RenewalHelper", "NamepassResolver"]) {
  const artifact = JSON.parse(readFileSync(resolve(root, `out/${name}.sol/${name}.json`), "utf8"));
  const metadata = artifact.metadata;
  const declarations = new Map();
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (node.nodeType === "VariableDeclaration" && node.mutability === "immutable") declarations.set(String(node.id), node.name);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === "object") walk(value);
    }
  }
  walk(artifact.ast);
  const immutables = Object.entries(artifact.deployedBytecode.immutableReferences ?? {}).map(([id, positions]) => {
    const variable = declarations.get(id);
    if (!variable) throw new Error(`${name}: missing immutable declaration ${id}`);
    return { variable, positions };
  });
  const { compilationTarget, ...settings } = metadata.settings;
  settings.outputSelection = { "*": { "*": ["abi", "evm.bytecode", "evm.deployedBytecode"] } };
  const standardInput = {
    language: "Solidity", settings,
    sources: Object.fromEntries(Object.keys(metadata.sources).map(path => [path, { content: readFileSync(resolve(root, path), "utf8") }])),
  };
  contracts[name] = {
    abi: artifact.abi, bytecode: artifact.bytecode.object, runtime: artifact.deployedBytecode.object,
    immutables, compiler: metadata.compiler.version,
    source: Object.keys(compilationTarget)[0], standardInput,
  };
}
const resolver = contracts.NamepassResolver;
delete contracts.NamepassResolver;
const expectedFactoryHash = "0x5d7c4144f9fbbcdab03ddd87f7abcaf361ed91607373baae682e4457462ddb1f";
if (keccak256(contracts.NamepassFactory.bytecode) !== expectedFactoryHash) throw new Error("Factory creation code changed. Review the build before deployment.");
const fingerprint = keccak256(stringToHex(JSON.stringify(contracts)));
const folder = new URL("generated/", import.meta.url);
mkdirSync(folder, { recursive: true });
writeFileSync(new URL("resolver.json", folder), JSON.stringify(resolver));
writeFileSync(new URL("bundle.json", folder), JSON.stringify({ fingerprint, contracts }));
console.log(`Deployment artifacts ready: ${fingerprint}`);
