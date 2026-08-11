import { rollupAdminLogicPublicActions } from '@arbitrum/chain-sdk';
import { expectAtLeastPositionalArgs, primaryRuntime } from '../common.js';
import { getCoreContracts, getDeployerAccount, parentChainPublicClient } from './common.js';

const oneDayBaseBlocks = 43_200n;
const maxUint64 = (1n << 64n) - 1n;

const [targetConfirmPeriodBlocksInput, ...extraArgs] = expectAtLeastPositionalArgs(
  0,
  'npx tsx deployments/primary/scripts/crynux-on-base/set-confirm-period-blocks.ts [targetConfirmPeriodBlocks]',
);

if (extraArgs.length > 0) {
  throw new Error(
    'Usage: npx tsx deployments/primary/scripts/crynux-on-base/set-confirm-period-blocks.ts [targetConfirmPeriodBlocks] --network=<testnet|mainnet>',
  );
}

function parseTargetConfirmPeriodBlocks(value: string | undefined): bigint {
  if (value === undefined) {
    return oneDayBaseBlocks;
  }

  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error('targetConfirmPeriodBlocks must be a positive integer.');
  }

  const parsedValue = BigInt(value);
  if (parsedValue > maxUint64) {
    throw new Error('targetConfirmPeriodBlocks must fit in uint64.');
  }

  return parsedValue;
}

function formatApproxDuration(blocks: bigint): string {
  const seconds = blocks * 2n;
  const days = seconds / 86_400n;
  const hours = (seconds % 86_400n) / 3_600n;
  const minutes = (seconds % 3_600n) / 60n;

  return `${days.toString()}d ${hours.toString()}h ${minutes.toString()}m`;
}

const deployer = await getDeployerAccount();
const coreContracts = getCoreContracts();
const parentChainClient = parentChainPublicClient.extend(
  rollupAdminLogicPublicActions({
    rollup: coreContracts.rollup,
  }),
);
const targetConfirmPeriodBlocks = parseTargetConfirmPeriodBlocks(targetConfirmPeriodBlocksInput);

const currentConfirmPeriodBlocks = await parentChainClient.rollupAdminLogicReadContract({
  functionName: 'confirmPeriodBlocks',
});

console.log('Rollup:', coreContracts.rollup);
console.log('Upgrade executor:', coreContracts.upgradeExecutor);
console.log('Operator account:', deployer.address);
console.log('Network:', primaryRuntime.network);
console.log('Current confirm period blocks:', currentConfirmPeriodBlocks.toString());
console.log('Current approximate Base duration:', formatApproxDuration(currentConfirmPeriodBlocks));
console.log('Target confirm period blocks:', targetConfirmPeriodBlocks.toString());
console.log('Target approximate Base duration:', formatApproxDuration(targetConfirmPeriodBlocks));

if (currentConfirmPeriodBlocks === targetConfirmPeriodBlocks) {
  console.log('Confirm period blocks are already configured. Skipping transaction.');
  process.exit(0);
}

const transactionRequest = await parentChainClient.rollupAdminLogicPrepareTransactionRequest({
  functionName: 'setConfirmPeriodBlocks',
  args: [targetConfirmPeriodBlocks],
  upgradeExecutor: coreContracts.upgradeExecutor,
  account: deployer.address,
});

const hash = await parentChainClient.sendRawTransaction({
  serializedTransaction: await deployer.signTransaction(transactionRequest),
});
const transactionReceipt = await parentChainClient.waitForTransactionReceipt({ hash });

console.log('Set confirm period blocks transaction receipt:');
console.log(JSON.stringify(transactionReceipt, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2));
