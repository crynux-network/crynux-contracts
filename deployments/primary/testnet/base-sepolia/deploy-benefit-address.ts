import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { assertAddress, baseContracts, basePublicClient, type BaseContracts } from './common.js';

const contractsFile = new URL('./contracts.json', import.meta.url);
const deploymentId = 'primary-testnet-base-sepolia-deploy-benefit-address';
const ignitionAddressesFile = resolve('ignition', 'deployments', deploymentId, 'deployed_addresses.json');
const ignitionAddressKeys = [
  'DeployBenefitAddress#BenefitAddress',
  'DeployBenefitAddress#benefitAddress',
];

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
  console.log('Base Sepolia BenefitAddress is already recorded. Skipping deployment.');
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
  'baseSepolia',
]);

const deployedAddresses = JSON.parse(await readFile(ignitionAddressesFile, 'utf8')) as Record<string, string>;
const benefitAddress = assertAddress(getDeployedAddress(deployedAddresses), 'ignition.BenefitAddress');
const updatedContracts: BaseContracts = {
  ...baseContracts,
  benefitAddress,
  benefitAddressDeployedAtBlockNumber: Number(await basePublicClient.getBlockNumber()),
};

await writeFile(contractsFile, `${JSON.stringify(updatedContracts, null, 2)}\n`);

console.log('Base Sepolia BenefitAddress recorded:');
console.log(JSON.stringify(updatedContracts, null, 2));
