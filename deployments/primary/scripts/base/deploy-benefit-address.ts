import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  buildPrimaryDeploymentId,
  getPrimaryLayerFile,
  primaryRuntime,
  run,
  expectPositionalArgs,
} from '../common.js';
import { assertAddress, baseContracts, basePublicClient, type BaseContracts } from './common.js';

expectPositionalArgs(0, 'npx tsx deployments/primary/scripts/base/deploy-benefit-address.ts');

const contractsFile = getPrimaryLayerFile('base', 'contracts.json');
const deploymentId = buildPrimaryDeploymentId('primary-base-deploy-benefit-address');
const ignitionAddressesFile = resolve('ignition', 'deployments', deploymentId, 'deployed_addresses.json');
const ignitionAddressKeys = [
  'DeployBenefitAddress#BenefitAddress',
  'DeployBenefitAddress#benefitAddress',
];

function getDeployedAddress(deployedAddresses: Record<string, string>): string {
  for (const key of ignitionAddressKeys) {
    const address = deployedAddresses[key];

    if (address !== undefined) {
      return address;
    }
  }

  throw new Error(`Could not find BenefitAddress in ${ignitionAddressesFile}.`);
}

if (baseContracts.benefitAddress !== '') {
  console.log(`${primaryRuntime.names.base} BenefitAddress is already recorded. Skipping deployment.`);
  console.log(JSON.stringify(baseContracts, null, 2));
  process.exit(0);
}

await run('npx', [
  'hardhat',
  'ignition',
  'deploy',
  'ignition/modules/deploy-benefit-address.ts',
  '--deployment-id',
  deploymentId,
  '--network',
  primaryRuntime.hardhatNetworks.base,
]);

const deployedAddresses = JSON.parse(await readFile(ignitionAddressesFile, 'utf8')) as Record<string, string>;
const benefitAddress = assertAddress(getDeployedAddress(deployedAddresses), 'ignition.BenefitAddress');
const updatedContracts: BaseContracts = {
  ...baseContracts,
  benefitAddress,
  benefitAddressDeployedAtBlockNumber: Number(await basePublicClient.getBlockNumber()),
};

await writeFile(contractsFile, `${JSON.stringify(updatedContracts, null, 2)}\n`);

console.log(`${primaryRuntime.names.base} BenefitAddress recorded:`);
console.log(JSON.stringify(updatedContracts, null, 2));
