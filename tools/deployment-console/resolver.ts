import { concat, encodeDeployData, getAddress, getCreate2Address, keccak256, padHex, stringToHex, type Abi, type Address, type Hex } from "viem";
import generated from "./generated/resolver.json";
import { SINGLETON, type Plan } from "./model";

export const resolverArtifact = generated as unknown as { abi: Abi; bytecode: Hex; runtime: Hex; immutables: { variable: string; positions: { start: number; length: number }[] }[]; compiler: string; source: string; standardInput: unknown };
export const ENS_REGISTRY = getAddress("0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e");
export const PARENT = "namepass.eth";
export type ResolverConfig = { apex: Address; avatar: string; description: string; url: string; gatewayUrl: string };
export function resolverDeployment(plan: Plan, config: ResolverConfig) {
 if (!config.gatewayUrl.startsWith("https://")) throw new Error("The CCIP gateway must use HTTPS.");
 const args = [getAddress(config.apex), config.avatar, config.description, config.url, config.gatewayUrl];
 const initcode = encodeDeployData({ abi: resolverArtifact.abi, bytecode: resolverArtifact.bytecode, args });
 const salt = keccak256(stringToHex(`${plan.config.saltLabel}:NamepassResolver:mainnet:testnet-addresses`));
 const address = getCreate2Address({ from: SINGLETON, salt, bytecode: initcode });
 let code = resolverArtifact.runtime.slice(2);
 const values: Record<string, Address> = { owner: SINGLETON, apexAddr: getAddress(config.apex) };
 for (const { variable, positions } of resolverArtifact.immutables) {
  if (!values[variable]) throw new Error(`Unknown resolver immutable ${variable}.`);
  for (const { start, length } of positions) {
   if (length !== 32) throw new Error("Unexpected resolver immutable length.");
   code = code.slice(0, start * 2) + padHex(values[variable], { size: 32 }).slice(2) + code.slice((start + length) * 2);
  }
 }
 return { address, data: concat([salt, initcode]), runtime: `0x${code}` as Hex, config, constructorArgs: `0x${initcode.slice(resolverArtifact.bytecode.length)}` as Hex };
}
