import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  buildPrimaryDeploymentId,
  getPrimaryLayerFile,
  primaryRuntime,
  run,
  expectPositionalArgs,
} from '../common.js';
import { assertAddress, type EthereumContracts } from './common.js';

expectPositionalArgs(0, 'npx tsx deployments/primary/scripts/ethereum/deploy-token.ts');

const contractsFile = getPrimaryLayerFile('ethereum', 'contracts.json');
const deploymentId = buildPrimaryDeploymentId('deploy-l1-erc20-crynux-token');
const ignitionAddressesFile = resolve('ignition', 'deployments', deploymentId, 'deployed_addresses.json');
const ignitionAddressKeys = [
  'DeployL1Erc20CrynuxToken#CrynuxToken',
  'DeployL1Erc20CrynuxToken#crynuxToken',
];

function getDeployedAddress(deployedAddresses: Record<string, string>): string {
  for (const key of ignitionAddressKeys) {
    const address = deployedAddresses[key];

    if (address !== undefined) {
      return address;
    }
  }

  throw new Error(`Could not find CrynuxToken in ${ignitionAddressesFile}.`);
}

const contracts = JSON.parse(await readFile(contractsFile, 'utf8')) as EthereumContracts;

if (contracts.crynuxTokenAddress !== '') {
  console.log(`${primaryRuntime.names.ethereum} CNX token is already recorded. Skipping deployment.`);
  console.log(JSON.stringify(contracts, null, 2));
  process.exit(0);
}

await run('npx', [
  'hardhat',
  'ignition',
  'deploy',
  'ignition/modules/deploy-l1-erc20-crynux-token.ts',
  '--deployment-id',
  deploymentId,
  '--network',
  primaryRuntime.hardhatNetworks.ethereum,
]);

const deployedAddresses = JSON.parse(await readFile(ignitionAddressesFile, 'utf8')) as Record<string, string>;
const crynuxTokenAddress = assertAddress(getDeployedAddress(deployedAddresses), 'ignition.CrynuxToken');
const updatedContracts = {
  ...contracts,
  crynuxTokenAddress,
};

await writeFile(contractsFile, `${JSON.stringify(updatedContracts, null, 2)}\n`);

console.log(`${primaryRuntime.names.ethereum} CNX token recorded:`);
console.log(JSON.stringify(updatedContracts, null, 2));
