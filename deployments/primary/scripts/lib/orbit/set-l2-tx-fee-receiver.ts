import { arbGasInfoPublicActions, arbOwnerPublicActions } from '@arbitrum/chain-sdk';
import type { Address } from 'viem';
import { expectAtLeastPositionalArgs, getPrimaryConfig } from '../../common.js';
import { orbitRuntime, getDeployerAccount, orbitChainPublicClient, assertAddress, deploymentConfig } from './runtime.js';

const [transactionMaxFeePerGasInput, ...extraArgs] = expectAtLeastPositionalArgs(
  0,
  `npx tsx deployments/primary/scripts/${orbitRuntime.scriptDir}/set-l2-tx-fee-receiver.ts [transactionMaxFeePerGasWei]`,
);

if (extraArgs.length > 0) {
  throw new Error(
    `Usage: npx tsx deployments/primary/scripts/${orbitRuntime.scriptDir}/set-l2-tx-fee-receiver.ts [transactionMaxFeePerGasWei] --network=<testnet|mainnet>`,
  );
}

function parseOptionalTransactionMaxFeePerGas(value: string | undefined): bigint | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error('transactionMaxFeePerGasWei must be a positive integer in wei.');
  }

  return BigInt(value);
}

const primaryConfig = await getPrimaryConfig();
const daoTreasuryAddress = assertAddress(primaryConfig.daoTreasuryAddress, 'common.daoTreasuryAddress');
const deployer = await getDeployerAccount();
const orbitChainClient = orbitChainPublicClient.extend(arbGasInfoPublicActions).extend(arbOwnerPublicActions);
const transactionMaxFeePerGas = parseOptionalTransactionMaxFeePerGas(transactionMaxFeePerGasInput);

console.log('Transaction max fee per gas override:', transactionMaxFeePerGas?.toString() ?? 'network default');

function isSameAddress(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function applyTransactionMaxFeePerGasOverride(
  transactionRequest: Parameters<typeof deployer.signTransaction>[0],
): Parameters<typeof deployer.signTransaction>[0] {
  if (transactionMaxFeePerGas === undefined) {
    return transactionRequest;
  }

  return {
    ...transactionRequest,
    gasPrice: undefined,
    maxFeePerGas: transactionMaxFeePerGas,
    maxPriorityFeePerGas:
      transactionRequest.maxPriorityFeePerGas !== undefined && transactionRequest.maxPriorityFeePerGas <= transactionMaxFeePerGas
        ? transactionRequest.maxPriorityFeePerGas
        : BigInt(0),
  };
}

async function waitForOwnerTransaction(transactionRequest: Parameters<typeof deployer.signTransaction>[0], label: string) {
  const hash = await orbitChainClient.sendRawTransaction({
    serializedTransaction: await deployer.signTransaction(applyTransactionMaxFeePerGasOverride(transactionRequest)),
  });
  const transactionReceipt = await orbitChainClient.waitForTransactionReceipt({ hash });

  console.log(`${label} transaction receipt:`);
  console.log(JSON.stringify(transactionReceipt, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2));
}

const isDeployerChainOwner = await orbitChainClient.arbOwnerReadContract({
  functionName: 'isChainOwner',
  args: [deployer.address],
});

if (!isDeployerChainOwner) {
  throw new Error(`Deployer ${deployer.address} is not a ${deploymentConfig.name} chain owner.`);
}

const currentInfraFeeAccount = await orbitChainClient.arbOwnerReadContract({
  functionName: 'getInfraFeeAccount',
});
console.log('Current infrastructure fee account:', currentInfraFeeAccount);
console.log('Target infrastructure fee account:', daoTreasuryAddress);

if (isSameAddress(currentInfraFeeAccount, daoTreasuryAddress)) {
  console.log('Infrastructure fee account is already configured. Skipping transaction.');
} else {
  await waitForOwnerTransaction(
    await orbitChainClient.arbOwnerPrepareTransactionRequest({
      functionName: 'setInfraFeeAccount',
      args: [daoTreasuryAddress],
      upgradeExecutor: false,
      account: deployer.address,
    }),
    'Set infrastructure fee account',
  );
}

const currentNetworkFeeAccount = await orbitChainClient.arbOwnerReadContract({
  functionName: 'getNetworkFeeAccount',
});
console.log('Current network fee account:', currentNetworkFeeAccount);
console.log('Target network fee account:', daoTreasuryAddress);

if (isSameAddress(currentNetworkFeeAccount, daoTreasuryAddress)) {
  console.log('Network fee account is already configured. Skipping transaction.');
} else {
  await waitForOwnerTransaction(
    await orbitChainClient.arbOwnerPrepareTransactionRequest({
      functionName: 'setNetworkFeeAccount',
      args: [daoTreasuryAddress],
      upgradeExecutor: false,
      account: deployer.address,
    }),
    'Set network fee account',
  );
}

const currentL1PricingRewardRecipient = await orbitChainClient.arbGasInfoReadContract({
  functionName: 'getL1RewardRecipient',
});
console.log('Current L1 pricing reward recipient:', currentL1PricingRewardRecipient);
console.log('Target L1 pricing reward recipient:', daoTreasuryAddress);

if (isSameAddress(currentL1PricingRewardRecipient, daoTreasuryAddress)) {
  console.log('L1 pricing reward recipient is already configured. Skipping transaction.');
} else {
  await waitForOwnerTransaction(
    await orbitChainClient.arbOwnerPrepareTransactionRequest({
      functionName: 'setL1PricingRewardRecipient',
      args: [daoTreasuryAddress],
      upgradeExecutor: false,
      account: deployer.address,
    }),
    'Set L1 pricing reward recipient',
  );
}
