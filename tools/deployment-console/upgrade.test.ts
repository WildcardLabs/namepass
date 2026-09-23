import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, zeroHash } from "viem";
import { buildPlan, bundle, HUB, SINGLETON } from "./model";
import { buildUpgrade, parseUpgrade, staticUpgradeTx, UPGRADE_STEPS } from "./upgrade";
const plan = buildPlan({ owner:"0x1208a26FAa0F4AC65B42098419EB4dAA5e580AC6", residueRecipient:"0x1208a26FAa0F4AC65B42098419EB4dAA5e580AC6", referrer:zeroHash, saltLabel:"upgrade-tests", delay:60 });
test("replacement changes only helper address, with distinct timelock operations", () => {
 const upgrade=buildUpgrade(plan);
 assert.notEqual(upgrade.helper.address,plan.deployments.ENSV2RenewalHelper.address);
 assert.equal(upgrade.helper.runtime,plan.deployments.ENSV2RenewalHelper.runtime);
 assert.deepEqual(upgrade.helper.args,plan.deployments.ENSV2RenewalHelper.args);
 assert.equal(upgrade.helperPlan.deployments.NamepassL1Gateway.address,plan.deployments.NamepassL1Gateway.address);
 assert.notEqual(upgrade.activate.id,upgrade.restore.id);
 for(const [op,next] of [[upgrade.activate,upgrade.helper.address],[upgrade.restore,plan.deployments.ENSV2RenewalHelper.address]] as const){
  const schedule=decodeFunctionData({abi:bundle.contracts.TimelockController.abi,data:op.schedule});
  assert.equal(schedule.functionName,"schedule");assert.equal(schedule.args![0],plan.deployments.RenewalHelperPointer.address);assert.equal(schedule.args![5],60n);
  const call=decodeFunctionData({abi:bundle.contracts.RenewalHelperPointer.abi,data:schedule.args![2] as `0x${string}`});assert.equal(call.args![0],next);
 }
});
test("rehearsal import rejects changed targets, calldata, chains and duplicate hashes", () => {
 const tx=staticUpgradeTx(plan,"deploy"), hash=`0x${"11".repeat(32)}`;
 assert.equal(tx.to,SINGLETON); assert.equal(tx.chainId,HUB);assert.equal(UPGRADE_STEPS.length,8);
 const record={id:"deploy",hash,status:"verified",tx:{chainId:tx.chainId,to:tx.to,data:tx.data}};const data={version:1,fingerprint:plan.fingerprint,records:[record]};
 assert.equal(parseUpgrade(JSON.stringify(data),plan).records.length,1);
 for(const changed of [{...record,tx:{...record.tx,to:plan.config.owner}},{...record,tx:{...record.tx,data:"0x00"}},{...record,tx:{...record.tx,chainId:1}}]) assert.throws(()=>parseUpgrade(JSON.stringify({...data,records:[changed]}),plan));
 assert.throws(()=>parseUpgrade(JSON.stringify({...data,records:[record,record]}),plan));
});
