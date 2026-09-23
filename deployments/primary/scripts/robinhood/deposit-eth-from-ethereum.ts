import { BigNumber } from '@ethersproject/bignumber';
import { Wallet } from '@ethersproject/wallet';
import { EthBridger } from '@arbitrum/sdk';
import { formatEther, parseEther } from 'viem';
import { expectPositionalArgs, primaryRuntime } from '../common.js';
import {
  ethereumPublicClient,
  getConfiguredDeployerPrivateKey,
  registerRobinhoodNetwork,
  robinhoodPublicClient,
} from './common.js';

const [amountInput] = expectPositionalArgs(
  1,
  'npx tsx deployments/primary/scripts/robinhood/deposit-eth-from-ethereum.ts <amount>',
);

if (!/^(?:[1-9]\d*|0)(?:\.\d{1,18})?$/.test(amountInput)) {
  throw new Error('ETH amount must be a positive decimal value with up to 18 decimals.');
}

const amount = parseEther(amountInput);

if (amount <= 0n) {
  throw new Error('ETH amount must be greater than zero.');
}

const { network, parentProvider, childProvider } = await registerRobinhoodNetwork();
const parentSigner = new Wallet(await getConfiguredDeployerPrivateKey(), parentProvider);
const bridger = new EthBridger(network);
const accountAddress = parentSigner.address as `0x${string}`;
const [parentBalanceBefore, childBalanceBefore] = await Promise.all([
  ethereumPublicClient.getBalance({ address: accountAddress }),
  robinhoodPublicClient.getBalance({ address: accountAddress }),
]);

if (parentBalanceBefore < amount) {
  throw new Error(
    `Insufficient ${primaryRuntime.names.ethereum} ETH balance. Required ${formatEther(amount)}, available ${formatEther(parentBalanceBefore)}.`,
  );
}

console.log(`${primaryRuntime.names.ethereum} ETH deposit to ${primaryRuntime.names.robinhood}:`);
console.log(JSON.stringify({
  account: parentSigner.address,
  amount: formatEther(amount),
  parentBalanceBefore: formatEther(parentBalanceBefore),
  childBalanceBefore: formatEther(childBalanceBefore),
}, null, 2));

const depositTransaction = await bridger.deposit({
  amount: BigNumber.from(amount.toString()),
  parentSigner,
});
const depositReceipt = await depositTransaction.wait();

console.log('ETH deposit transaction receipt:');
console.log(JSON.stringify(depositReceipt, (_key, value) => (
  typeof value === 'bigint' ? value.toString() : value
), 2));

const childResult = await depositReceipt.waitForChildTransactionReceipt(childProvider);

if (!childResult.complete) {
  throw new Error(`${primaryRuntime.names.robinhood} ETH deposit did not complete.`);
}

const childBalanceAfter = await robinhoodPublicClient.getBalance({ address: accountAddress });

console.log(`${primaryRuntime.names.robinhood} ETH deposit completed.`);
console.log(JSON.stringify({
  account: parentSigner.address,
  childBalanceAfter: formatEther(childBalanceAfter),
  childBalanceDelta: formatEther(childBalanceAfter - childBalanceBefore),
}, null, 2));
