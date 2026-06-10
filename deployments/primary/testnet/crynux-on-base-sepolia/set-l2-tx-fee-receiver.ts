import { arbGasInfoPublicActions, arbOwnerPublicActions } from '@arbitrum/chain-sdk';
import type { Address } from 'viem';
import { primaryConfig, assertAddress } from '../../common.js';
import { getDeployerAccount, orbitChainPublicClient } from './common.js';

const daoTreasuryAddress = assertAddress(primaryConfig.daoTreasuryAddress, 'common.daoTreasuryAddress');
const deployer = await getDeployerAccount();
const orbitChainClient = orbitChainPublicClient.extend(arbGasInfoPublicActions).extend(arbOwnerPublicActions);

function isSameAddress(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

async function waitForOwnerTransaction(transactionRequest: Parameters<typeof deployer.signTransaction>[0], label: string) {
  const hash = await orbitChainClient.sendRawTransaction({
    serializedTransaction: await deployer.signTransaction(transactionRequest),
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
  throw new Error(`Deployer ${deployer.address} is not a Crynux on Base Sepolia chain owner.`);
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
