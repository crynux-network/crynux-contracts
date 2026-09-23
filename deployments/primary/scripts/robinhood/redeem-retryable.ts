import { ParentToChildMessageStatus, ParentTransactionReceipt } from '@arbitrum/sdk';
import { BigNumber } from '@ethersproject/bignumber';
import { Wallet } from '@ethersproject/wallet';
import { formatUnits, parseUnits } from 'viem';
import { expectAtLeastPositionalArgs, primaryRuntime } from '../common.js';
import {
  getConfiguredDeployerPrivateKey,
  registerRobinhoodNetwork,
} from './common.js';

const [
  parentTxHash,
  retryableCreationId,
  gasLimitInput,
  maxFeePerGasInput,
  maxPriorityFeePerGasInput,
  ...extraArgs
] = expectAtLeastPositionalArgs(
  2,
  'npx tsx deployments/primary/scripts/robinhood/redeem-retryable.ts <parentTxHash> <retryableCreationId> [gasLimit] [maxFeePerGasGwei] [maxPriorityFeePerGasGwei]',
);

if (extraArgs.length > 0) {
  throw new Error(
    'Usage: npx tsx deployments/primary/scripts/robinhood/redeem-retryable.ts <parentTxHash> <retryableCreationId> [gasLimit] [maxFeePerGasGwei] [maxPriorityFeePerGasGwei] --network=<testnet|mainnet>',
  );
}

if (!/^0x[0-9a-fA-F]{64}$/.test(parentTxHash)) {
  throw new Error('Parent transaction hash must be a 32-byte hex string.');
}

if (!/^0x[0-9a-fA-F]{64}$/.test(retryableCreationId)) {
  throw new Error('Retryable creation id must be a 32-byte hex string.');
}

function statusName(status: ParentToChildMessageStatus): string {
  return ParentToChildMessageStatus[status];
}

function parseGasLimit(value: string): BigNumber {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error('gasLimit must be a positive integer.');
  }

  return BigNumber.from(value);
}

function parseGwei(value: string, name: string): BigNumber {
  if (!/^\d+(?:\.\d{1,9})?$/.test(value)) {
    throw new Error(`${name} must be a non-negative decimal gwei value with up to 9 decimals.`);
  }

  return BigNumber.from(parseUnits(value, 9).toString());
}

const { parentProvider, childProvider } = await registerRobinhoodNetwork();
const childSigner = new Wallet(await getConfiguredDeployerPrivateKey(), childProvider);
const parentReceipt = await parentProvider.getTransactionReceipt(parentTxHash);

if (parentReceipt === null) {
  throw new Error(`Parent transaction ${parentTxHash} was not found.`);
}

if (parentReceipt.status !== 1) {
  throw new Error(`Parent transaction ${parentTxHash} did not succeed.`);
}

const messages = await new ParentTransactionReceipt(parentReceipt).getParentToChildMessages(childSigner);
const message = messages.find(
  (candidate) => candidate.retryableCreationId.toLowerCase() === retryableCreationId.toLowerCase(),
);

if (message === undefined) {
  throw new Error(`Retryable ${retryableCreationId} was not found in parent transaction ${parentTxHash}.`);
}

const initialResult = await message.getSuccessfulRedeem();
const initialStatusName = statusName(initialResult.status);

console.log(`${primaryRuntime.names.robinhood} retryable state:`);
console.log(JSON.stringify({
  parentTxHash,
  retryableCreationId,
  status: initialStatusName,
  redeemer: childSigner.address,
  retryableGasLimit: message.messageData.gasLimit.toString(),
  retryableMaxFeePerGasGwei: formatUnits(BigInt(message.messageData.maxFeePerGas.toString()), 9),
}, null, 2));

if (initialResult.status === ParentToChildMessageStatus.REDEEMED) {
  console.log(`Retryable ${retryableCreationId} is already redeemed.`);
  process.exit(0);
}

if (initialResult.status !== ParentToChildMessageStatus.FUNDS_DEPOSITED_ON_CHILD) {
  throw new Error(`Retryable ${retryableCreationId} cannot be redeemed from status ${initialStatusName}.`);
}

const redeemOverrides = {
  gasLimit: gasLimitInput === undefined ? message.messageData.gasLimit : parseGasLimit(gasLimitInput),
  maxFeePerGas: maxFeePerGasInput === undefined
    ? message.messageData.maxFeePerGas
    : parseGwei(maxFeePerGasInput, 'maxFeePerGasGwei'),
  maxPriorityFeePerGas: maxPriorityFeePerGasInput === undefined
    ? BigNumber.from(0)
    : parseGwei(maxPriorityFeePerGasInput, 'maxPriorityFeePerGasGwei'),
};
const redeemTransaction = await message.redeem(redeemOverrides);
const redeemReceipt = await redeemTransaction.wait();
const finalResult = await message.getSuccessfulRedeem();

console.log(`${primaryRuntime.names.robinhood} retryable redeem result:`);
console.log(JSON.stringify({
  retryableCreationId,
  redeemTxHash: redeemReceipt.transactionHash,
  redeemStatus: redeemReceipt.status,
  finalStatus: statusName(finalResult.status),
}, null, 2));

if (finalResult.status !== ParentToChildMessageStatus.REDEEMED) {
  throw new Error(`Retryable ${retryableCreationId} final status is ${statusName(finalResult.status)}.`);
}
