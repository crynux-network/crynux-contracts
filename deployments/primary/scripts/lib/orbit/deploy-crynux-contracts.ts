import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { orbitRuntime, getOrbitLayerFile, assertAddress, deploymentConfig, deploymentContracts, orbitChainPublicClient, type OrbitDeploymentContracts } from './runtime.js';
import { buildPrimaryCacheFileName, buildPrimaryDeploymentId, expectPositionalArgs, primaryRuntime, run, } from '../../common.js';

expectPositionalArgs(0, `npx tsx deployments/primary/scripts/${orbitRuntime.scriptDir}/deploy-crynux-contracts.ts`);

const paramsPath = resolve('cache', buildPrimaryCacheFileName(orbitRuntime.target === 'base' ? 'primary-crynux-on-base-deploy-l2-node-contracts-params' : 'primary-crynux-on-rh-deploy-l2-node-contracts-params'));
const contractsFile = getOrbitLayerFile('contracts.json');
const deploymentId = buildPrimaryDeploymentId(orbitRuntime.target === 'base' ? 'primary-crynux-on-base-deploy-l2-node-contracts' : 'primary-crynux-on-rh-deploy-l2-node-contracts');
const ignitionAddressesFile = resolve('ignition', 'deployments', deploymentId, 'deployed_addresses.json');
const ignitionAddressKeys = {
  benefitAddress: ['DeployNodeContracts#BenefitAddress', 'DeployNodeContracts#benefitAddress'],
  delegatedStaking: ['DeployNodeContracts#DelegatedStaking', 'DeployNodeContracts#delegatedStaking'],
  nodeStaking: ['DeployNodeContracts#NodeStaking', 'DeployNodeContracts#nodeStaking'],
} as const;

function getDeployedAddress(deployedAddresses: Record<string, string>, keys: readonly string[], name: string): string {
  for (const key of keys) {
    const address = deployedAddresses[key];

    if (address !== undefined) {
      return address;
    }
  }

  throw new Error(`Could not find ${name} in ${ignitionAddressesFile}.`);
}

if (deploymentContracts.nodeContracts !== undefined) {
  console.log(`${orbitRuntime.orbitName} node contracts are already recorded. Skipping deployment.`);
  console.log(JSON.stringify(deploymentContracts.nodeContracts, null, 2));
  process.exit(0);
}

const nodeContractParams = deploymentConfig['crynux-contracts-params'];
const deployNodeContractsParams = {
  DeployNodeContracts: {
    relayOperatorAddress: assertAddress(nodeContractParams.relayOperatorAddress, 'crynux-contracts-params.relayOperatorAddress'),
    slashReceiverAddress: assertAddress(nodeContractParams.slashReceiverAddress, 'crynux-contracts-params.slashReceiverAddress'),
    nodeMinStakeAmount: nodeContractParams.nodeMinStakeAmount,
    delegatedMinStakeAmount: nodeContractParams.delegatedMinStakeAmount,
    forceUnstakeDelay: nodeContractParams.forceUnstakeDelay,
  },
};

await mkdir(dirname(paramsPath), { recursive: true });
await writeFile(paramsPath, `${JSON.stringify(deployNodeContractsParams, null, 2)}\n`);

console.log(`Crynux contract deployment parameters written to ${paramsPath}`);
await run('npx', [
  'hardhat',
  'ignition',
  'deploy',
  'ignition/modules/deploy-l2-node-contracts.ts',
  '--deployment-id',
  deploymentId,
  '--network',
  orbitRuntime.orbitHardhatNetwork,
  '--parameters',
  paramsPath,
]);

const deployedAddresses = JSON.parse(await readFile(ignitionAddressesFile, 'utf8')) as Record<string, string>;
const updatedContracts: OrbitDeploymentContracts = {
  ...deploymentContracts,
  nodeContracts: {
    benefitAddress: assertAddress(getDeployedAddress(deployedAddresses, ignitionAddressKeys.benefitAddress, 'BenefitAddress'), 'ignition.BenefitAddress'),
    delegatedStaking: assertAddress(
      getDeployedAddress(deployedAddresses, ignitionAddressKeys.delegatedStaking, 'DelegatedStaking'),
      'ignition.DelegatedStaking',
    ),
    nodeStaking: assertAddress(getDeployedAddress(deployedAddresses, ignitionAddressKeys.nodeStaking, 'NodeStaking'), 'ignition.NodeStaking'),
    deployedAtBlockNumber: Number(await orbitChainPublicClient.getBlockNumber()),
  },
};

await writeFile(contractsFile, `${JSON.stringify(updatedContracts, null, 2)}\n`);

console.log(`${orbitRuntime.orbitName} node contracts recorded:`);
console.log(JSON.stringify(updatedContracts.nodeContracts, null, 2));
