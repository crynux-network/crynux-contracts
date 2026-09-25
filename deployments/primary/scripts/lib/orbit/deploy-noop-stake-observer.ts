import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  assertAddress,
  deploymentContracts,
  getOrbitLayerFile,
  orbitRuntime,
  type OrbitDeploymentContracts,
} from './runtime.js';
import { buildPrimaryDeploymentId, expectPositionalArgs, run } from '../../common.js';

expectPositionalArgs(0, `npx tsx deployments/primary/scripts/${orbitRuntime.scriptDir}/deploy-noop-stake-observer.ts`);

const nodeContracts = deploymentContracts.nodeContracts;
if (nodeContracts === undefined) {
  throw new Error(
    `${orbitRuntime.orbitName} node contracts are not recorded. Run deploy-crynux-contracts first.`,
  );
}

if (nodeContracts.noopStakeObserver !== undefined) {
  console.log(`${orbitRuntime.orbitName} NoOpStakeObserver is already recorded. Skipping deployment.`);
  console.log(JSON.stringify(nodeContracts, null, 2));
  process.exit(0);
}

const contractsFile = getOrbitLayerFile('contracts.json');
const deploymentId = buildPrimaryDeploymentId(
  orbitRuntime.target === 'base'
    ? 'primary-crynux-on-base-deploy-noop-stake-observer'
    : 'primary-crynux-on-rh-deploy-noop-stake-observer',
);
const ignitionAddressesFile = resolve('ignition', 'deployments', deploymentId, 'deployed_addresses.json');
const ignitionAddressKeys = [
  'DeployNoOpStakeObserver#NoOpStakeObserver',
  'DeployNoOpStakeObserver#noopStakeObserver',
] as const;

function getDeployedAddress(deployedAddresses: Record<string, string>, keys: readonly string[], name: string): string {
  for (const key of keys) {
    const address = deployedAddresses[key];
    if (address !== undefined) {
      return address;
    }
  }
  throw new Error(`Could not find ${name} in ${ignitionAddressesFile}.`);
}

await run('npx', [
  'hardhat',
  'ignition',
  'deploy',
  'ignition/modules/deploy-noop-stake-observer.ts',
  '--deployment-id',
  deploymentId,
  '--network',
  orbitRuntime.orbitHardhatNetwork,
]);

const deployedAddresses = JSON.parse(await readFile(ignitionAddressesFile, 'utf8')) as Record<string, string>;
const noopStakeObserver = assertAddress(
  getDeployedAddress(deployedAddresses, ignitionAddressKeys, 'NoOpStakeObserver'),
  'ignition.NoOpStakeObserver',
);

const updatedContracts: OrbitDeploymentContracts = {
  ...deploymentContracts,
  nodeContracts: {
    ...nodeContracts,
    noopStakeObserver,
  },
};

await writeFile(contractsFile, `${JSON.stringify(updatedContracts, null, 2)}\n`);

console.log(`${orbitRuntime.orbitName} NoOpStakeObserver recorded:`);
console.log(JSON.stringify(updatedContracts.nodeContracts, null, 2));
