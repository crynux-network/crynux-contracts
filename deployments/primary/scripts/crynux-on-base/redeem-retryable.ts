import { ParentToChildMessageStatus, ParentTransactionReceipt } from '@arbitrum/sdk';
import { BigNumber } from '@ethersproject/bignumber';
import { Wallet } from '@ethersproject/wallet';
import { formatUnits, parseUnits } from 'viem';
import { registerCrynuxOnBaseNetwork } from './bridge-network.js';
import {
  createOrbitChainProvider,
  createParentChainProvider,
  deploymentConfig,
  getConfiguredDeployerPrivateKey,
} from './common.js';
import { expectAtLeastPositionalArgs } from '../common.js';

const [parentTxHash, retryableCreationId, gasLimitInput, maxFeePerGasInput, maxPriorityFeePerGasInput] = expectAtLeastPositionalArgs(
  2,
  'npx tsx deployments/primary/scripts/crynux-on-base/redeem-retryable.ts <parentTxHash> <retryableCreationId> [gasLimit] [maxFeePerGasGwei] [maxPriorityFeePerGasGwei]',
);

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
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error('gasLimit must be a positive integer.');
  }

  return BigNumber.from(value);
}

function parseGwei(value: string, name: string): BigNumber {
  if (!/^[0-9]+(\.[0-9]+)?$/.test(value)) {
    throw new Error(`${name} must be a non-negative decimal gwei value.`);
  }

  return BigNumber.from(parseUnits(value, 9).toString());
}

const parentChainProvider = createParentChainProvider();
const orbitChainProvider = createOrbitChainProvider();
const orbitChainSigner = new Wallet(await getConfiguredDeployerPrivateKey(), orbitChainProvider);

await registerCrynuxOnBaseNetwork(parentChainProvider);

const parentReceipt = await parentChainProvider.getTransactionReceipt(parentTxHash);

if (parentReceipt === null) {
  throw new Error(`Parent transaction ${parentTxHash} was not found.`);
}

if (parentReceipt.status !== 1) {
  throw new Error(`Parent transaction ${parentTxHash} did not succeed.`);
}

const parentTransactionReceipt = new ParentTransactionReceipt(parentReceipt);
const messages = await parentTransactionReceipt.getParentToChildMessages(orbitChainSigner);
const message = messages.find(
  (candidate) => candidate.retryableCreationId.toLowerCase() === retryableCreationId.toLowerCase(),
);

if (message === undefined) {
  throw new Error(`Retryable ${retryableCreationId} was not found in parent transaction ${parentTxHash}.`);
}

const creationReceipt = await message.getRetryableCreationReceipt(0, 0);
const autoRedeemReceipt = creationReceipt === null ? null : await message.getAutoRedeemAttempt();
const initialResult = await message.getSuccessfulRedeem();
const initialStatusName = statusName(initialResult.status);
const signerBalance = await orbitChainProvider.getBalance(orbitChainSigner.address);

console.log(`${deploymentConfig.name} retryable state:`);
console.log(
  JSON.stringify(
    {
      parentTxHash,
      retryableCreationId,
      status: initialStatusName,
      redeemer: orbitChainSigner.address,
      redeemerNativeBalance: formatUnits(BigInt(signerBalance.toString()), 18),
      retryableGasLimit: message.messageData.gasLimit.toString(),
      retryableMaxFeePerGasGwei: formatUnits(BigInt(message.messageData.maxFeePerGas.toString()), 9),
      creationReceipt: creationReceipt === null
        ? null
        : {
            transactionHash: creationReceipt.transactionHash,
            status: creationReceipt.status,
            blockNumber: creationReceipt.blockNumber,
            gasUsed: creationReceipt.gasUsed.toString(),
          },
      autoRedeemReceipt: autoRedeemReceipt === null
        ? null
        : {
            transactionHash: autoRedeemReceipt.transactionHash,
            status: autoRedeemReceipt.status,
            blockNumber: autoRedeemReceipt.blockNumber,
            gasUsed: autoRedeemReceipt.gasUsed.toString(),
          },
    },
    null,
    2,
  ),
);

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

console.log(`Redeeming retryable ${retryableCreationId} from ${orbitChainSigner.address}...`);
console.log(
  JSON.stringify(
    {
      gasLimit: redeemOverrides.gasLimit.toString(),
      maxFeePerGasGwei: formatUnits(BigInt(redeemOverrides.maxFeePerGas.toString()), 9),
      maxPriorityFeePerGasGwei: formatUnits(BigInt(redeemOverrides.maxPriorityFeePerGas.toString()), 9),
      maxGasCost: formatUnits(
        BigInt(redeemOverrides.gasLimit.toString()) * BigInt(redeemOverrides.maxFeePerGas.toString()),
        18,
      ),
    },
    null,
    2,
  ),
);

const redeemTransaction = await message.redeem(redeemOverrides);
const redeemReceipt = await redeemTransaction.wait();
const finalResult = await message.getSuccessfulRedeem();

console.log(`${deploymentConfig.name} retryable redeem result:`);
console.log(
  JSON.stringify(
    {
      retryableCreationId,
      redeemTxHash: redeemReceipt.transactionHash,
      redeemStatus: redeemReceipt.status,
      redeemBlockNumber: redeemReceipt.blockNumber,
      redeemGasUsed: redeemReceipt.gasUsed.toString(),
      finalStatus: statusName(finalResult.status),
    },
    null,
    2,
  ),
);

if (finalResult.status !== ParentToChildMessageStatus.REDEEMED) {
  throw new Error(`Retryable ${retryableCreationId} final status is ${statusName(finalResult.status)}.`);
}
