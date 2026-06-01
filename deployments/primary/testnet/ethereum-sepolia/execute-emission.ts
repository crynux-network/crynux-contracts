import { createWalletClient, formatUnits, http, parseAbi } from 'viem';
import { sepolia as ethereumSepolia } from 'viem/chains';
import {
  assertAddress,
  ethereumContracts,
  ethereumPublicClient,
  ethereumRpcUrl,
  getEthereumDeployerAccount,
} from './common.js';

const emissionAbi = parseAbi([
  'function emission() external',
  'function nextEmissionIndex() view returns (uint256)',
]);
const erc20Abi = parseAbi(['function balanceOf(address account) view returns (uint256)']);
const waitAfterEmissionMs = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const tokenAddress = assertAddress(ethereumContracts.crynuxTokenAddress, 'contracts.crynuxTokenAddress');
const emissionContractAddress = assertAddress(ethereumContracts.emissionContractAddress, 'contracts.emissionContractAddress');
const account = await getEthereumDeployerAccount();
const walletClient = createWalletClient({
  account,
  chain: ethereumSepolia,
  transport: http(ethereumRpcUrl),
});

const nextEmissionIndex = await ethereumPublicClient.readContract({
  address: emissionContractAddress,
  abi: emissionAbi,
  functionName: 'nextEmissionIndex',
});
const latestBlock = await ethereumPublicClient.getBlock();
const balanceBefore = await ethereumPublicClient.readContract({
  address: tokenAddress,
  abi: erc20Abi,
  functionName: 'balanceOf',
  args: [emissionContractAddress],
});

console.log('Ethereum Sepolia emission execution state:');
console.log(
  JSON.stringify(
    {
      account: account.address,
      emissionContract: emissionContractAddress,
      nextEmissionIndex: nextEmissionIndex.toString(),
      latestBlockTimestamp: latestBlock.timestamp.toString(),
      emissionContractBalanceBefore: formatUnits(balanceBefore, 18),
    },
    null,
    2,
  ),
);

let hash: `0x${string}`;

try {
  hash = await walletClient.writeContract({
    address: emissionContractAddress,
    abi: emissionAbi,
    functionName: 'emission',
  });
} catch (error) {
  console.log('No executable emission is available. The emission contract rejected the call.');
  if (error instanceof Error) {
    console.log(error.message);
  }
  process.exit(0);
}

const transactionReceipt = await ethereumPublicClient.waitForTransactionReceipt({ hash });

console.log(`Waiting ${waitAfterEmissionMs / 1000} seconds before reading updated emission state.`);
await sleep(waitAfterEmissionMs);

const updatedNextEmissionIndex = await ethereumPublicClient.readContract({
  address: emissionContractAddress,
  abi: emissionAbi,
  functionName: 'nextEmissionIndex',
});
const balanceAfter = await ethereumPublicClient.readContract({
  address: tokenAddress,
  abi: erc20Abi,
  functionName: 'balanceOf',
  args: [emissionContractAddress],
});

console.log('Ethereum Sepolia emission transaction receipt:');
console.log(JSON.stringify(transactionReceipt, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2));
console.log(`Updated nextEmissionIndex: ${updatedNextEmissionIndex.toString()}`);
console.log(`Emission contract balance after: ${formatUnits(balanceAfter, 18)}`);
