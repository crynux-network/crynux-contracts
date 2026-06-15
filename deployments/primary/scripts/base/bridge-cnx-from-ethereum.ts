import { formatUnits, parseAbi, parseUnits } from 'viem';
import { expectPositionalArgs, primaryRuntime } from '../common.js';
import {
  baseNetworkContracts,
  basePublicClient,
  bridgedCrynuxToken,
  ethereumPublicClient,
  getBaseCrynuxTokenAddress,
  getEthereumCrynuxTokenAddress,
  getEthereumDeployerWalletClient,
} from './common.js';

const standardBridgeAbi = parseAbi([
  'function bridgeERC20(address localToken,address remoteToken,uint256 amount,uint32 minGasLimit,bytes extraData)',
]);
const erc20Abi = parseAbi([
  'function allowance(address owner,address spender) view returns (uint256)',
  'function approve(address spender,uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
]);
const minGasLimit = 200000;
const bridgeCompletionWaitMs = 120_000;

function getBridgeAmount(): bigint {
  const [amountArg] = expectPositionalArgs(
    1,
    'npx tsx deployments/primary/scripts/base/bridge-cnx-from-ethereum.ts <integer-cnx-amount>',
  );

  if (!/^[1-9]\d*$/.test(amountArg)) {
    throw new Error('The CNX amount must be a positive integer.');
  }

  return parseUnits(amountArg, bridgedCrynuxToken.decimals);
}

const amount = getBridgeAmount();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const ethereumCrynuxTokenAddress = getEthereumCrynuxTokenAddress();
const baseCrynuxTokenAddress = getBaseCrynuxTokenAddress();
const walletClient = await getEthereumDeployerWalletClient();
const account = walletClient.account;

if (account === undefined) {
  throw new Error(`${primaryRuntime.names.ethereum} deployer account is required.`);
}

const balance = await ethereumPublicClient.readContract({
  address: ethereumCrynuxTokenAddress,
  abi: erc20Abi,
  functionName: 'balanceOf',
  args: [account.address],
});

if (balance < amount) {
  throw new Error(`Insufficient ${primaryRuntime.names.ethereum} CNX balance. Required ${formatUnits(amount, 18)}, available ${formatUnits(balance, 18)}.`);
}

const allowance = await ethereumPublicClient.readContract({
  address: ethereumCrynuxTokenAddress,
  abi: erc20Abi,
  functionName: 'allowance',
  args: [account.address, baseNetworkContracts.l1StandardBridgeOnEthereum],
});

if (allowance < amount) {
  const approveHash = await walletClient.writeContract({
    address: ethereumCrynuxTokenAddress,
    abi: erc20Abi,
    functionName: 'approve',
    args: [baseNetworkContracts.l1StandardBridgeOnEthereum, amount],
  });
  const approveReceipt = await ethereumPublicClient.waitForTransactionReceipt({ hash: approveHash });

  console.log('Approve transaction receipt:');
  console.log(JSON.stringify(approveReceipt, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2));
}

const bridgeHash = await walletClient.writeContract({
  address: baseNetworkContracts.l1StandardBridgeOnEthereum,
  abi: standardBridgeAbi,
  functionName: 'bridgeERC20',
  args: [ethereumCrynuxTokenAddress, baseCrynuxTokenAddress, amount, minGasLimit, '0x'],
});
const bridgeReceipt = await ethereumPublicClient.waitForTransactionReceipt({ hash: bridgeHash });

console.log(`${primaryRuntime.names.ethereum} to ${primaryRuntime.names.base} CNX bridge transaction receipt:`);
console.log(JSON.stringify(bridgeReceipt, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2));

console.log(`Waiting ${bridgeCompletionWaitMs / 1000} seconds for ${primaryRuntime.names.base} bridge finalization...`);
await sleep(bridgeCompletionWaitMs);

const baseBalance = await basePublicClient.readContract({
  address: baseCrynuxTokenAddress,
  abi: erc20Abi,
  functionName: 'balanceOf',
  args: [account.address],
});

console.log(`${primaryRuntime.names.base} CNX balance for ${account.address}: ${formatUnits(baseBalance, bridgedCrynuxToken.decimals)}`);
