import { writeFile } from 'node:fs/promises';
import { decodeEventLog, parseAbi, type Address } from 'viem';
import { expectPositionalArgs, getPrimaryLayerFile, primaryRuntime } from '../common.js';
import {
  baseContracts,
  baseNetworkContracts,
  basePublicClient,
  bridgedCrynuxToken,
  getBaseDeployerWalletClient,
  getEthereumCrynuxTokenAddress,
} from './common.js';

expectPositionalArgs(0, 'npx tsx deployments/primary/scripts/base/create-bridged-token.ts');

const factoryAbi = parseAbi([
  'function createOptimismMintableERC20(address remoteToken,string name,string symbol) returns (address)',
  'event OptimismMintableERC20Created(address indexed localToken,address indexed remoteToken,address deployer)',
  'event StandardL2TokenCreated(address indexed remoteToken,address indexed localToken)',
]);

if (baseContracts.baseCrynuxTokenAddress !== '') {
  console.log(`${primaryRuntime.names.base} CNX token is already recorded. Skipping creation.`);
  console.log(JSON.stringify(baseContracts, null, 2));
  process.exit(0);
}

const walletClient = await getBaseDeployerWalletClient();
const ethereumCrynuxTokenAddress = getEthereumCrynuxTokenAddress();
const hash = await walletClient.writeContract({
  address: baseNetworkContracts.optimismMintableERC20Factory,
  abi: factoryAbi,
  functionName: 'createOptimismMintableERC20',
  args: [ethereumCrynuxTokenAddress, bridgedCrynuxToken.name, bridgedCrynuxToken.symbol],
});
const receipt = await basePublicClient.waitForTransactionReceipt({ hash });

let baseCrynuxTokenAddress: Address | undefined;

for (const log of receipt.logs) {
  try {
    const decoded = decodeEventLog({
      abi: factoryAbi,
      data: log.data,
      topics: log.topics,
    });

    if (decoded.eventName === 'OptimismMintableERC20Created') {
      baseCrynuxTokenAddress = decoded.args.localToken;
      break;
    }

    if (decoded.eventName === 'StandardL2TokenCreated') {
      baseCrynuxTokenAddress = decoded.args.localToken;
    }
  } catch {
    continue;
  }
}

if (baseCrynuxTokenAddress === undefined) {
  throw new Error(`Could not find the ${primaryRuntime.names.base} CNX token address in factory events.`);
}

const updatedContracts = {
  ...baseContracts,
  baseCrynuxTokenAddress,
  createdAtBlockNumber: Number(receipt.blockNumber),
};

await writeFile(getPrimaryLayerFile('base', 'contracts.json'), `${JSON.stringify(updatedContracts, null, 2)}\n`);

console.log(`${primaryRuntime.names.base} CNX token created:`);
console.log(JSON.stringify(updatedContracts, null, 2));
