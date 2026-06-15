import { formatEther, parseAbi, parseEther } from 'viem';
import { expectPositionalArgs, primaryRuntime } from '../common.js';
import {
  baseNetworkContracts,
  basePublicClient,
  ethereumPublicClient,
  getEthereumDeployerWalletClient,
} from './common.js';

const standardBridgeAbi = parseAbi([
  'function bridgeETH(uint32 minGasLimit,bytes extraData) payable',
]);
const minGasLimit = 200000;
const bridgeCompletionWaitMs = 120_000;

function getBridgeAmount(): bigint {
  const [amountArg] = expectPositionalArgs(
    1,
    'npx tsx deployments/primary/scripts/base/bridge-eth-from-ethereum.ts <eth-amount>',
  );

  if (!/^(?:[1-9]\d*|0)(?:\.\d{1,18})?$/.test(amountArg)) {
    throw new Error('The ETH amount must be a positive decimal value with up to 18 decimals.');
  }

  const amount = parseEther(amountArg);

  if (amount <= 0n) {
    throw new Error('The ETH amount must be greater than zero.');
  }

  return amount;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const amount = getBridgeAmount();
const walletClient = await getEthereumDeployerWalletClient();
const account = walletClient.account;

if (account === undefined) {
  throw new Error(`${primaryRuntime.names.ethereum} deployer account is required.`);
}

const balance = await ethereumPublicClient.getBalance({ address: account.address });

if (balance < amount) {
  throw new Error(`Insufficient ${primaryRuntime.names.ethereum} ETH balance. Required ${formatEther(amount)}, available ${formatEther(balance)}.`);
}

const bridgeHash = await walletClient.writeContract({
  address: baseNetworkContracts.l1StandardBridgeOnEthereum,
  abi: standardBridgeAbi,
  functionName: 'bridgeETH',
  args: [minGasLimit, '0x'],
  value: amount,
});
const bridgeReceipt = await ethereumPublicClient.waitForTransactionReceipt({ hash: bridgeHash });

console.log(`${primaryRuntime.names.ethereum} to ${primaryRuntime.names.base} ETH bridge transaction receipt:`);
console.log(JSON.stringify(bridgeReceipt, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2));

console.log(`Waiting ${bridgeCompletionWaitMs / 1000} seconds for ${primaryRuntime.names.base} bridge finalization...`);
await sleep(bridgeCompletionWaitMs);

const baseBalance = await basePublicClient.getBalance({ address: account.address });

console.log(`${primaryRuntime.names.base} ETH balance for ${account.address}: ${formatEther(baseBalance)}`);
