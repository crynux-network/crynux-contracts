import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { assertAddress, type EthereumContracts } from './common.js';

const contractsFile = new URL('./contracts.json', import.meta.url);
const deploymentId = 'deploy-l1-erc20-crynux-token';
const ignitionAddressesFile = resolve('ignition', 'deployments', deploymentId, 'deployed_addresses.json');
const ignitionAddressKeys = [
  'DeployL1Erc20CrynuxToken#CrynuxToken',
  'DeployL1Erc20CrynuxToken#crynuxToken',
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

  throw new Error(`Could not find CrynuxToken in ${ignitionAddressesFile}.`);
}

const contracts = JSON.parse(await readFile(contractsFile, 'utf8')) as EthereumContracts;

if (contracts.crynuxTokenAddress !== '') {
  console.log('Ethereum Sepolia CNX token is already recorded. Skipping deployment.');
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
  'ethereumSepolia',
]);

const deployedAddresses = JSON.parse(await readFile(ignitionAddressesFile, 'utf8')) as Record<string, string>;
const crynuxTokenAddress = assertAddress(getDeployedAddress(deployedAddresses), 'ignition.CrynuxToken');
const updatedContracts = {
  ...contracts,
  crynuxTokenAddress,
};

await writeFile(contractsFile, `${JSON.stringify(updatedContracts, null, 2)}\n`);

console.log('Ethereum Sepolia CNX token recorded:');
console.log(JSON.stringify(updatedContracts, null, 2));
