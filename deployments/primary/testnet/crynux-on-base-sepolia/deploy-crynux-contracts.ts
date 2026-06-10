import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import {
  assertAddress,
  deploymentConfig,
  deploymentContracts,
  orbitChainPublicClient,
  type CrynuxOnBaseContracts,
} from './common.js';

const paramsPath = resolve('cache/primary-testnet-crynux-on-base-sepolia-deploy-l2-node-contracts-params.json');
const contractsFile = new URL('./contracts.json', import.meta.url);
const deploymentId = 'primary-testnet-crynux-on-base-sepolia-deploy-l2-node-contracts';
const ignitionAddressesFile = resolve('ignition', 'deployments', deploymentId, 'deployed_addresses.json');
const disabledCreditsAdminAddress = '0x0000000000000000000000000000000000000000';
const ignitionAddressKeys = {
  credits: ['DeployNodeContracts#Credits', 'DeployNodeContracts#credits'],
  benefitAddress: ['DeployNodeContracts#BenefitAddress', 'DeployNodeContracts#benefitAddress'],
  delegatedStaking: ['DeployNodeContracts#DelegatedStaking', 'DeployNodeContracts#delegatedStaking'],
  nodeStaking: ['DeployNodeContracts#NodeStaking', 'DeployNodeContracts#nodeStaking'],
  parameterController: ['DeployNodeContracts#ParameterController', 'DeployNodeContracts#parameterController'],
} as const;

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      shell: true,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code: number | null) => {
      if (code === 0) {
        resolveRun();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}.`));
    });
  });
}

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
  console.log('Crynux on Base Sepolia node contracts are already recorded. Skipping deployment.');
  console.log(JSON.stringify(deploymentContracts.nodeContracts, null, 2));
  process.exit(0);
}

const nodeContractParams = deploymentConfig['crynux-contracts-params'];
const creditsAdminAddress = nodeContractParams.creditsAdminAddress === '' ? disabledCreditsAdminAddress : nodeContractParams.creditsAdminAddress;
const deployNodeContractsParams = {
  DeployNodeContracts: {
    relayOperatorAddress: assertAddress(nodeContractParams.relayOperatorAddress, 'crynux-contracts-params.relayOperatorAddress'),
    creditsAdminAddress: assertAddress(creditsAdminAddress, 'crynux-contracts-params.creditsAdminAddress'),
    parameterWriterAddress: assertAddress(
      nodeContractParams.parameterWriterAddress,
      'crynux-contracts-params.parameterWriterAddress',
    ),
    slashReceiverAddress: assertAddress(nodeContractParams.slashReceiverAddress, 'crynux-contracts-params.slashReceiverAddress'),
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
  'crynuxOnBaseSepolia',
  '--parameters',
  paramsPath,
]);

const deployedAddresses = JSON.parse(await readFile(ignitionAddressesFile, 'utf8')) as Record<string, string>;
const updatedContracts: CrynuxOnBaseContracts = {
  ...deploymentContracts,
  nodeContracts: {
    credits: assertAddress(getDeployedAddress(deployedAddresses, ignitionAddressKeys.credits, 'Credits'), 'ignition.Credits'),
    benefitAddress: assertAddress(getDeployedAddress(deployedAddresses, ignitionAddressKeys.benefitAddress, 'BenefitAddress'), 'ignition.BenefitAddress'),
    delegatedStaking: assertAddress(
      getDeployedAddress(deployedAddresses, ignitionAddressKeys.delegatedStaking, 'DelegatedStaking'),
      'ignition.DelegatedStaking',
    ),
    nodeStaking: assertAddress(getDeployedAddress(deployedAddresses, ignitionAddressKeys.nodeStaking, 'NodeStaking'), 'ignition.NodeStaking'),
    parameterController: assertAddress(
      getDeployedAddress(deployedAddresses, ignitionAddressKeys.parameterController, 'ParameterController'),
      'ignition.ParameterController',
    ),
    deployedAtBlockNumber: Number(await orbitChainPublicClient.getBlockNumber()),
  },
};

await writeFile(contractsFile, `${JSON.stringify(updatedContracts, null, 2)}\n`);

console.log('Crynux on Base Sepolia node contracts recorded:');
console.log(JSON.stringify(updatedContracts.nodeContracts, null, 2));
