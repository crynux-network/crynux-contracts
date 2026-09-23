import { writeFile } from 'node:fs/promises';
import { BigNumber } from '@ethersproject/bignumber';
import { Wallet } from '@ethersproject/wallet';
import { formatUnits, parseAbi, parseUnits, type Address } from 'viem';
import {
  assertAddress,
  expectAtLeastPositionalArgs,
  getPrimaryLayerFile,
  primaryRuntime,
} from '../common.js';
import { resolveAndValidateTokenBinding } from '../lib/arbitrum/network.js';
import {
  ethereumPublicClient,
  getCrynuxTokenBindingForDeposit,
  getConfiguredDeployerPrivateKey,
  robinhoodContracts,
  robinhoodPublicClient,
} from './common.js';

const erc20Abi = parseAbi([
  'function allowance(address owner,address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
]);
const [amountInput, destinationAddressInput, ...extraArgs] = expectAtLeastPositionalArgs(
  1,
  'npx tsx deployments/primary/scripts/robinhood/deposit-cnx-from-ethereum.ts <amount> [destinationAddress]',
);

if (extraArgs.length > 0) {
  throw new Error(
    'Usage: npx tsx deployments/primary/scripts/robinhood/deposit-cnx-from-ethereum.ts <amount> [destinationAddress] --network=<testnet|mainnet>',
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
  parentProvider,
  childProvider,
} = await getCrynuxTokenBindingForDeposit();
const parentSigner = new Wallet(await getConfiguredDeployerPrivateKey(), parentProvider);
const destinationAddress = destinationAddressInput === undefined
  ? parentSigner.address as Address
  : assertAddress(destinationAddressInput, 'destinationAddress');
const gatewayAddress = await bridger.getParentGatewayAddress(ethereumCrynuxTokenAddress, parentProvider) as Address;
const childTokenBytecode = await robinhoodPublicClient.getBytecode({ address: robinhoodCrynuxTokenAddress });
const [parentBalanceBefore, allowance, childBalanceBefore] = await Promise.all([
  ethereumPublicClient.readContract({
    address: ethereumCrynuxTokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [parentSigner.address as Address],
  }),
  ethereumPublicClient.readContract({
    address: ethereumCrynuxTokenAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [parentSigner.address as Address, gatewayAddress],
  }),
  childTokenBytecode === undefined || childTokenBytecode === '0x'
    ? Promise.resolve(0n)
    : robinhoodPublicClient.readContract({
      address: robinhoodCrynuxTokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [destinationAddress],
    }),
]);

if (parentBalanceBefore < amount) {
  throw new Error(
    `Insufficient ${primaryRuntime.names.ethereum} CNX balance. Required ${formatUnits(amount, 18)}, available ${formatUnits(parentBalanceBefore, 18)}.`,
  );
}

console.log(`${primaryRuntime.names.ethereum} CNX deposit to ${primaryRuntime.names.robinhood}:`);
console.log(JSON.stringify({
  account: parentSigner.address,
  destinationAddress,
  ethereumCrynuxTokenAddress,
  robinhoodCrynuxTokenAddress,
  gatewayAddress,
  amount: formatUnits(amount, 18),
  parentBalanceBefore: formatUnits(parentBalanceBefore, 18),
  childBalanceBefore: formatUnits(childBalanceBefore, 18),
}, null, 2));

if (allowance < amount) {
  const approveTransaction = await bridger.approveToken({
    erc20ParentAddress: ethereumCrynuxTokenAddress,
    amount: BigNumber.from(amount.toString()),
    parentSigner,
  });
  const approveReceipt = await approveTransaction.wait();

  console.log('CNX approve transaction receipt:');
  console.log(JSON.stringify(approveReceipt, (_key, value) => (
    typeof value === 'bigint' ? value.toString() : value
  ), 2));
}

const depositTransaction = await bridger.deposit({
  amount: BigNumber.from(amount.toString()),
  erc20ParentAddress: ethereumCrynuxTokenAddress,
  parentSigner,
  childProvider,
  destinationAddress,
});
const depositReceipt = await depositTransaction.wait();

console.log('CNX deposit transaction receipt:');
console.log(JSON.stringify(depositReceipt, (_key, value) => (
  typeof value === 'bigint' ? value.toString() : value
), 2));

const childResult = await depositReceipt.waitForChildTransactionReceipt(childProvider);

if (!childResult.complete) {
  throw new Error(`${primaryRuntime.names.robinhood} CNX deposit did not complete.`);
}

await resolveAndValidateTokenBinding(
  bridger,
  ethereumCrynuxTokenAddress,
  parentProvider,
  childProvider,
  robinhoodCrynuxTokenAddress,
);
const childBalanceAfter = await robinhoodPublicClient.readContract({
  address: robinhoodCrynuxTokenAddress,
  abi: erc20Abi,
  functionName: 'balanceOf',
  args: [destinationAddress],
});
const updatedContracts = {
  ...robinhoodContracts,
  robinhoodCrynuxTokenAddress,
  resolvedAtBlockNumber: Number(await robinhoodPublicClient.getBlockNumber()),
};
await writeFile(
  getPrimaryLayerFile('robinhood', 'contracts.json'),
  `${JSON.stringify(updatedContracts, null, 2)}\n`,
);

console.log(`${primaryRuntime.names.robinhood} CNX deposit completed.`);
console.log(JSON.stringify({
  destinationAddress,
  childBalanceAfter: formatUnits(childBalanceAfter, 18),
  childBalanceDelta: formatUnits(childBalanceAfter - childBalanceBefore, 18),
}, null, 2));
