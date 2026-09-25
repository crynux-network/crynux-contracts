import { createWalletClient, http, parseAbi } from 'viem';

import { expectPositionalArgs } from '../../common.js';
import {
  assertAddress,
  deploymentContracts,
  getDeployerAccount,
  orbitChain,
  orbitChainPublicClient,
  orbitChainRpcUrl,
  orbitRuntime,
} from './runtime.js';

expectPositionalArgs(0, `npx tsx deployments/primary/scripts/${orbitRuntime.scriptDir}/set-noop-staking-observers.ts`);

const stakingAbi = parseAbi([
  'function owner() view returns (address)',
  'function setObserver(address addr)',
]);

const nodeContracts = deploymentContracts.nodeContracts;
if (nodeContracts === undefined) {
  throw new Error(
    `${orbitRuntime.orbitName} node contracts are not recorded. Run deploy-crynux-contracts first.`,
  );
}

const noopStakeObserver = assertAddress(
  nodeContracts.noopStakeObserver,
  'contracts.nodeContracts.noopStakeObserver',
);
const nodeStaking = assertAddress(nodeContracts.nodeStaking, 'contracts.nodeContracts.nodeStaking');
const delegatedStaking = assertAddress(
  nodeContracts.delegatedStaking,
  'contracts.nodeContracts.delegatedStaking',
);

const deployer = await getDeployerAccount();
const walletClient = createWalletClient({
  account: deployer,
  chain: orbitChain,
  transport: http(orbitChainRpcUrl),
});

async function assertDeployerIsOwner(stakingAddress: typeof nodeStaking, label: string): Promise<void> {
  const owner = await orbitChainPublicClient.readContract({
    address: stakingAddress,
    abi: stakingAbi,
    functionName: 'owner',
  });
  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error(
      `${label} owner is ${owner}, expected deployer ${deployer.address}. Cannot call setObserver.`,
    );
  }
}

async function setObserver(stakingAddress: typeof nodeStaking, label: string): Promise<void> {
  console.log(`Setting ${label} observer to NoOpStakeObserver ${noopStakeObserver}...`);
  const hash = await walletClient.writeContract({
    address: stakingAddress,
    abi: stakingAbi,
    functionName: 'setObserver',
    args: [noopStakeObserver],
  });
  const receipt = await orbitChainPublicClient.waitForTransactionReceipt({ hash });
  console.log(`${label} setObserver transaction: ${hash} (status ${receipt.status})`);
}

await assertDeployerIsOwner(nodeStaking, 'NodeStaking');
await assertDeployerIsOwner(delegatedStaking, 'DelegatedStaking');

await setObserver(nodeStaking, 'NodeStaking');
await setObserver(delegatedStaking, 'DelegatedStaking');

console.log(`${orbitRuntime.orbitName} staking observers set to NoOpStakeObserver ${noopStakeObserver}.`);
