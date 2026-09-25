import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  buildPrimaryDeploymentId,
  getPrimaryLayerFile,
  primaryRuntime,
  run,
  expectPositionalArgs,
} from '../common.js';
import { assertAddress, robinhoodContracts, robinhoodPublicClient, type RobinhoodContracts } from './common.js';

expectPositionalArgs(0, 'npx tsx deployments/primary/scripts/robinhood/deploy-benefit-address.ts');

const contractsFile = getPrimaryLayerFile('robinhood', 'contracts.json');
const deploymentId = buildPrimaryDeploymentId('primary-robinhood-deploy-benefit-address');
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

if (robinhoodContracts.benefitAddress !== '') {
  console.log(`${primaryRuntime.names.robinhood} BenefitAddress is already recorded. Skipping deployment.`);
  console.log(JSON.stringify(robinhoodContracts, null, 2));
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
  primaryRuntime.hardhatNetworks.robinhood,
]);

const deployedAddresses = JSON.parse(await readFile(ignitionAddressesFile, 'utf8')) as Record<string, string>;
const benefitAddress = assertAddress(getDeployedAddress(deployedAddresses), 'ignition.BenefitAddress');
const updatedContracts: RobinhoodContracts = {
  ...robinhoodContracts,
  benefitAddress,
  benefitAddressDeployedAtBlockNumber: Number(await robinhoodPublicClient.getBlockNumber()),
};

await writeFile(contractsFile, `${JSON.stringify(updatedContracts, null, 2)}\n`);

console.log(`${primaryRuntime.names.robinhood} BenefitAddress recorded:`);
console.log(JSON.stringify(updatedContracts, null, 2));
