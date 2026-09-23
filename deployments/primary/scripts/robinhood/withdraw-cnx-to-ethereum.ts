import { BigNumber } from '@ethersproject/bignumber';
import { Wallet } from '@ethersproject/wallet';
import { formatUnits, parseAbi, parseUnits, type Address } from 'viem';
import { assertAddress, expectAtLeastPositionalArgs, primaryRuntime } from '../common.js';
import {
  getConfiguredDeployerPrivateKey,
  getValidatedCrynuxTokenBinding,
  robinhoodPublicClient,
} from './common.js';

const erc20Abi = parseAbi(['function balanceOf(address account) view returns (uint256)']);
const [amountInput, destinationAddressInput, ...extraArgs] = expectAtLeastPositionalArgs(
  1,
  'npx tsx deployments/primary/scripts/robinhood/withdraw-cnx-to-ethereum.ts <amount> [destinationAddress]',
);

if (extraArgs.length > 0) {
  throw new Error(
    'Usage: npx tsx deployments/primary/scripts/robinhood/withdraw-cnx-to-ethereum.ts <amount> [destinationAddress] --network=<testnet|mainnet>',
  );
}

if (!/^(?:[1-9]\d*|0)(?:\.\d{1,18})?$/.test(amountInput)) {
  throw new Error('CNX amount must be a positive decimal value with up to 18 decimals.');
}

const amount = parseUnits(amountInput, 18);

if (amount <= 0n) {
  throw new Error('CNX amount must be greater than zero.');
}

const {
  bridger,
  ethereumCrynuxTokenAddress,
  robinhoodCrynuxTokenAddress,
  childProvider,
} = await getValidatedCrynuxTokenBinding();
const childSigner = new Wallet(await getConfiguredDeployerPrivateKey(), childProvider);
const destinationAddress = destinationAddressInput === undefined
  ? childSigner.address as Address
  : assertAddress(destinationAddressInput, 'destinationAddress');
const childBalanceBefore = await robinhoodPublicClient.readContract({
  address: robinhoodCrynuxTokenAddress,
  abi: erc20Abi,
  functionName: 'balanceOf',
  args: [childSigner.address as Address],
});

if (childBalanceBefore < amount) {
  throw new Error(
    `Insufficient ${primaryRuntime.names.robinhood} CNX balance. Required ${formatUnits(amount, 18)}, available ${formatUnits(childBalanceBefore, 18)}.`,
  );
}

console.log(`${primaryRuntime.names.robinhood} CNX withdrawal to ${primaryRuntime.names.ethereum}:`);
console.log(JSON.stringify({
  account: childSigner.address,
  destinationAddress,
  ethereumCrynuxTokenAddress,
  robinhoodCrynuxTokenAddress,
  amount: formatUnits(amount, 18),
  childBalanceBefore: formatUnits(childBalanceBefore, 18),
}, null, 2));

const withdrawalTransaction = await bridger.withdraw({
  amount: BigNumber.from(amount.toString()),
  erc20ParentAddress: ethereumCrynuxTokenAddress,
  childSigner,
  destinationAddress,
});
const withdrawalReceipt = await withdrawalTransaction.wait();
const childToParentEvents = withdrawalReceipt.getChildToParentEvents();

if (childToParentEvents.length === 0) {
  throw new Error('Withdrawal transaction did not emit a child-to-parent message.');
}

console.log(`${primaryRuntime.names.robinhood} CNX withdrawal initiated.`);
console.log(JSON.stringify({
  withdrawalTxHash: withdrawalReceipt.transactionHash,
  childChain: primaryRuntime.names.robinhood,
  parentChain: primaryRuntime.names.ethereum,
  destinationAddress,
  amount: formatUnits(amount, 18),
  childToParentMessageCount: childToParentEvents.length,
  nextStep: 'Save withdrawalTxHash and run claim-cnx-withdrawal.ts after the rollup assertion is confirmed.',
}, null, 2));
