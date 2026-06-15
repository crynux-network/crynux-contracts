import { EthBridger } from '@arbitrum/sdk';
import { BigNumber } from '@ethersproject/bignumber';
import { Wallet } from '@ethersproject/wallet';
import { formatUnits, parseUnits, type Address } from 'viem';
import { registerCrynuxOnBaseNetwork } from './bridge-network.js';
import {
  assertAddress,
  createOrbitChainProvider,
  createParentChainProvider,
  deploymentConfig,
  getConfiguredDeployerPrivateKey,
  orbitChainPublicClient,
} from './common.js';
import { expectAtLeastPositionalArgs, primaryRuntime } from '../common.js';

const [withdrawalAmountInput, destinationAddressInput] = expectAtLeastPositionalArgs(
  1,
  'npx tsx deployments/primary/scripts/crynux-on-base/withdraw-crynux-to-base.ts <amount> [destinationAddress]',
);

const withdrawalAmount = parseUnits(withdrawalAmountInput, 18);

if (withdrawalAmount <= 0n) {
  throw new Error('Withdrawal amount must be greater than zero.');
}

const parentChainProvider = createParentChainProvider();
const orbitChainProvider = createOrbitChainProvider();
const childSigner = new Wallet(await getConfiguredDeployerPrivateKey(), orbitChainProvider);
const destinationAddress = destinationAddressInput === undefined
  ? (childSigner.address as Address)
  : assertAddress(destinationAddressInput, 'destinationAddress');

await registerCrynuxOnBaseNetwork(parentChainProvider);

const childBalanceBefore = await orbitChainPublicClient.getBalance({ address: childSigner.address as Address });

if (childBalanceBefore < withdrawalAmount) {
  throw new Error(
    `Insufficient ${deploymentConfig.name} CNX balance. Required ${formatUnits(withdrawalAmount, 18)}, available ${formatUnits(childBalanceBefore, 18)}.`,
  );
}

const ethBridger = await EthBridger.fromProvider(orbitChainProvider);

console.log(`${deploymentConfig.name} to ${primaryRuntime.names.base} withdrawal state:`);
console.log(
  JSON.stringify(
    {
      account: childSigner.address,
      destinationAddress,
      amount: formatUnits(withdrawalAmount, 18),
      childNativeBalanceBefore: formatUnits(childBalanceBefore, 18),
    },
    null,
    2,
  ),
);

const withdrawalTransaction = await ethBridger.withdraw({
  amount: BigNumber.from(withdrawalAmount.toString()),
  childSigner,
  destinationAddress,
  from: childSigner.address,
});
const withdrawalTransactionReceipt = await withdrawalTransaction.wait();
const childToParentEvents = withdrawalTransactionReceipt.getChildToParentEvents();

if (childToParentEvents.length === 0) {
  throw new Error('Withdrawal transaction did not emit a child-to-parent message.');
}

console.log(`${deploymentConfig.name} withdrawal initiated.`);
console.log(
  JSON.stringify(
    {
      withdrawalTxHash: withdrawalTransactionReceipt.transactionHash,
      childChain: deploymentConfig.name,
      parentChain: primaryRuntime.names.base,
      destinationAddress,
      amount: formatUnits(withdrawalAmount, 18),
      childToParentMessageCount: childToParentEvents.length,
      nextStep:
        'Save withdrawalTxHash and run claim-crynux-withdrawal.ts with it after the rollup assertion is confirmed.',
    },
    null,
    2,
  ),
);
