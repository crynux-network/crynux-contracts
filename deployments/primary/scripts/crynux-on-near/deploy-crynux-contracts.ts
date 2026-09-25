import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  buildPrimaryCacheFileName,
  buildPrimaryDeploymentId,
  expectPositionalArgs,
  primaryRuntime,
  run,
} from '../common.js';
import {
  assertAddress,
  crynuxOnNearConfig,
  crynuxOnNearContracts,
  crynuxOnNearPublicClient,
  getCrynuxOnNearContractsFile,
  type CrynuxOnNearContracts,
} from './common.js';

expectPositionalArgs(0, 'npx tsx deployments/primary/scripts/crynux-on-near/deploy-crynux-contracts.ts');

const paramsPath = resolve('cache', buildPrimaryCacheFileName('primary-crynux-on-near-deploy-l2-node-contracts-params'));
const contractsFile = getCrynuxOnNearContractsFile();
const deploymentId = buildPrimaryDeploymentId('primary-crynux-on-near-deploy-l2-node-contracts');
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

if (crynuxOnNearContracts.nodeContracts !== undefined) {
  console.log(`${primaryRuntime.names.crynuxOnNear} node contracts are already recorded. Skipping deployment.`);
  console.log(JSON.stringify(crynuxOnNearContracts.nodeContracts, null, 2));
  process.exit(0);
}

const nodeContractParams = crynuxOnNearConfig['crynux-contracts-params'];

if (nodeContractParams === undefined || nodeContractParams === null || typeof nodeContractParams !== 'object') {
  throw new Error('crynux-on-near config must define crynux-contracts-params.');
}

function assertPositiveIntegerString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be a positive integer string.`);
  }

  return value;
}

function assertNonNegativeInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }

  return value;
}

const deployNodeContractsParams = {
  DeployNodeContracts: {
    relayOperatorAddress: assertAddress(nodeContractParams.relayOperatorAddress, 'crynux-contracts-params.relayOperatorAddress'),
    slashReceiverAddress: assertAddress(nodeContractParams.slashReceiverAddress, 'crynux-contracts-params.slashReceiverAddress'),
    nodeMinStakeAmount: assertPositiveIntegerString(nodeContractParams.nodeMinStakeAmount, 'crynux-contracts-params.nodeMinStakeAmount'),
    delegatedMinStakeAmount: assertPositiveIntegerString(nodeContractParams.delegatedMinStakeAmount, 'crynux-contracts-params.delegatedMinStakeAmount'),
    forceUnstakeDelay: assertNonNegativeInteger(nodeContractParams.forceUnstakeDelay, 'crynux-contracts-params.forceUnstakeDelay'),
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
  primaryRuntime.hardhatNetworks.crynuxOnNear,
  '--parameters',
  paramsPath,
]);

const deployedAddresses = JSON.parse(await readFile(ignitionAddressesFile, 'utf8')) as Record<string, string>;
const updatedContracts: CrynuxOnNearContracts = {
  ...crynuxOnNearContracts,
  nodeContracts: {
    benefitAddress: assertAddress(getDeployedAddress(deployedAddresses, ignitionAddressKeys.benefitAddress, 'BenefitAddress'), 'ignition.BenefitAddress'),
    delegatedStaking: assertAddress(
      getDeployedAddress(deployedAddresses, ignitionAddressKeys.delegatedStaking, 'DelegatedStaking'),
      'ignition.DelegatedStaking',
    ),
    nodeStaking: assertAddress(getDeployedAddress(deployedAddresses, ignitionAddressKeys.nodeStaking, 'NodeStaking'), 'ignition.NodeStaking'),
    deployedAtBlockNumber: Number(await crynuxOnNearPublicClient.getBlockNumber()),
  },
};

await writeFile(contractsFile, `${JSON.stringify(updatedContracts, null, 2)}\n`);

console.log(`${primaryRuntime.names.crynuxOnNear} node contracts recorded:`);
console.log(JSON.stringify(updatedContracts.nodeContracts, null, 2));
