import { ChildToParentMessageStatus, ChildTransactionReceipt } from '@arbitrum/sdk';
import type { BigNumber } from '@ethersproject/bignumber';
import type { JsonRpcProvider } from '@ethersproject/providers';
import { Wallet } from '@ethersproject/wallet';
import { registerCrynuxOnBaseNetwork } from './bridge-network.js';
import {
  createOrbitChainProvider,
  createParentChainProvider,
  deploymentConfig,
  getConfiguredDeployerPrivateKey,
} from './common.js';

const withdrawalTxHash = process.argv[2];

if (withdrawalTxHash === undefined) {
  throw new Error('Usage: npx tsx deployments/primary/testnet/crynux-on-base-sepolia/claim-crynux-withdrawal.ts <withdrawalTxHash>');
}

if (!/^0x[0-9a-fA-F]{64}$/.test(withdrawalTxHash)) {
  throw new Error('Withdrawal transaction hash must be a 32-byte hex string.');
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) {
    return 'now';
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  const parts: string[] = [];

  if (hours > 0) {
    parts.push(`${hours}h`);
  }

  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }

  if (hours === 0 && remainingSeconds > 0) {
    parts.push(`${remainingSeconds}s`);
  }

  return parts.join(' ');
}

async function estimateParentBlockTime(parentChainProvider: JsonRpcProvider): Promise<number> {
  const latestBlock = await parentChainProvider.getBlock('latest');
  const sampleDistance = Math.min(300, latestBlock.number);
  const sampleBlock = await parentChainProvider.getBlock(latestBlock.number - sampleDistance);
  const elapsedSeconds = latestBlock.timestamp - sampleBlock.timestamp;

  return elapsedSeconds / sampleDistance;
}

async function getExecutionEstimate(
  parentChainProvider: JsonRpcProvider,
  executableBlock: BigNumber | null,
): Promise<Record<string, string | number> | null> {
  if (executableBlock === null) {
    return null;
  }

  const currentParentBlock = await parentChainProvider.getBlockNumber();
  const executableBlockNumber = executableBlock.toNumber();
  const remainingBlocks = Math.max(0, executableBlockNumber - currentParentBlock);
  const averageBlockSeconds = await estimateParentBlockTime(parentChainProvider);
  const remainingSeconds = Math.ceil(remainingBlocks * averageBlockSeconds);
  const latestBlock = await parentChainProvider.getBlock('latest');
  const estimatedExecutableTimestamp = latestBlock.timestamp + remainingSeconds;

  return {
    currentParentBlock,
    executableParentBlock: executableBlockNumber,
    remainingParentBlocks: remainingBlocks,
    estimatedRemainingTime: formatDuration(remainingSeconds),
    estimatedExecutableAtUtc: new Date(estimatedExecutableTimestamp * 1000).toISOString(),
  };
}

const parentChainProvider = createParentChainProvider();
const orbitChainProvider = createOrbitChainProvider();
const parentChainSigner = new Wallet(await getConfiguredDeployerPrivateKey(), parentChainProvider);

await registerCrynuxOnBaseNetwork(parentChainProvider);

const withdrawalReceipt = await orbitChainProvider.getTransactionReceipt(withdrawalTxHash);

if (withdrawalReceipt === null) {
  throw new Error(`Withdrawal transaction ${withdrawalTxHash} was not found on ${deploymentConfig.name}.`);
}

const childTransactionReceipt = new ChildTransactionReceipt(withdrawalReceipt);
const childToParentEvents = childTransactionReceipt.getChildToParentEvents();

if (childToParentEvents.length === 0) {
  throw new Error(`Transaction ${withdrawalTxHash} did not emit any child-to-parent messages.`);
}

const messages = await childTransactionReceipt.getChildToParentMessages(parentChainSigner);

console.log('Crynux on Base Sepolia withdrawal status:');
console.log(
  JSON.stringify(
    {
      withdrawalTxHash,
      childChain: deploymentConfig.name,
      parentChain: 'Base Sepolia',
      childToParentMessageCount: messages.length,
    },
    null,
    2,
  ),
);

for (const [index, message] of messages.entries()) {
  const status = await message.status(orbitChainProvider);
  const statusName = ChildToParentMessageStatus[status];

  if (status === ChildToParentMessageStatus.UNCONFIRMED) {
    const executableBlock = await message.getFirstExecutableBlock(orbitChainProvider);
    const estimate = await getExecutionEstimate(parentChainProvider, executableBlock);

    console.log(
      JSON.stringify(
        {
          messageIndex: index,
          status: statusName,
          readyToExecute: false,
          estimate,
        },
        null,
        2,
      ),
    );
    continue;
  }

  if (status === ChildToParentMessageStatus.EXECUTED) {
    console.log(
      JSON.stringify(
        {
          messageIndex: index,
          status: statusName,
          readyToExecute: false,
          alreadyExecuted: true,
        },
        null,
        2,
      ),
    );
    continue;
  }

  console.log(
    JSON.stringify(
      {
        messageIndex: index,
        status: statusName,
        readyToExecute: true,
        action: 'Executing withdrawal on Base Sepolia.',
      },
      null,
      2,
    ),
  );

  const executionTransaction = await message.execute(orbitChainProvider);
  const executionReceipt = await executionTransaction.wait();

  console.log(
    JSON.stringify(
      {
        messageIndex: index,
        status: 'EXECUTED',
        parentTxHash: executionReceipt.transactionHash,
      },
      null,
      2,
    ),
  );
}
