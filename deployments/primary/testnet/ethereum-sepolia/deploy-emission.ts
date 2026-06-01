import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { primaryConfig } from '../../common.js';
import { assertAddress, ethereumConfig, ethereumContracts, ethereumPublicClient, type EthereumContracts } from './common.js';

const emissionParamsPath = resolve('cache/primary-testnet-deploy-emission-erc20-params.json');
const contractsFile = new URL('./contracts.json', import.meta.url);
const deploymentId = 'deploy-emission-erc20';
const ignitionAddressesFile = resolve('ignition', 'deployments', deploymentId, 'deployed_addresses.json');
const ignitionAddressKeys = ['DeployEmissionErc20#EmissionERC20', 'DeployEmissionErc20#emissionERC20'];

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

  throw new Error(`Could not find EmissionERC20 in ${ignitionAddressesFile}.`);
}

if (ethereumContracts.crynuxTokenAddress === '') {
  console.log('Deploy the canonical Ethereum Sepolia CNX token first:');
  console.log('npx tsx deployments/primary/testnet/ethereum-sepolia/deploy-token.ts');
  process.exit(0);
}

if (ethereumContracts.emissionContractAddress !== '') {
  console.log('Ethereum Sepolia EmissionERC20 is already recorded. Skipping deployment.');
  console.log(JSON.stringify(ethereumContracts, null, 2));
  process.exit(0);
}

assertAddress(ethereumContracts.crynuxTokenAddress, 'contracts.crynuxTokenAddress');
assertAddress(primaryConfig.daoTreasuryAddress, 'primary.common.daoTreasuryAddress');
assertAddress(primaryConfig.relayWalletColdAddress, 'primary.common.relayWalletColdAddress');

const emissionParams = {
  DeployEmissionErc20: {
    tokenAddress: ethereumContracts.crynuxTokenAddress,
    mode: ethereumConfig.emission.mode,
    daoTreasuryAddress: primaryConfig.daoTreasuryAddress,
    relayWalletColdAddress: primaryConfig.relayWalletColdAddress,
    startTimestamp: ethereumConfig.emission.startTimestamp,
    initialEmissionIndex: ethereumConfig.emission.initialEmissionIndex,
    initCostCNX: ethereumConfig.emission.initCostCNX,
    fundingAmountWei: ethereumConfig.emission.fundingAmountWei,
  },
};

await mkdir(dirname(emissionParamsPath), { recursive: true });
await writeFile(emissionParamsPath, `${JSON.stringify(emissionParams, null, 2)}\n`);

console.log(`Emission deployment parameters written to ${emissionParamsPath}`);
await run('npx', [
  'hardhat',
  'ignition',
  'deploy',
  'ignition/modules/deploy-emission-erc20.ts',
  '--deployment-id',
  deploymentId,
  '--network',
  'ethereumSepolia',
  '--parameters',
  emissionParamsPath,
]);

const deployedAddresses = JSON.parse(await readFile(ignitionAddressesFile, 'utf8')) as Record<string, string>;
const emissionContractAddress = assertAddress(getDeployedAddress(deployedAddresses), 'ignition.EmissionERC20');
const deployedAtBlockNumber = Number(await ethereumPublicClient.getBlockNumber());
const updatedContracts: EthereumContracts = {
  ...ethereumContracts,
  emissionContractAddress,
  deployedAtBlockNumber,
};

await writeFile(contractsFile, `${JSON.stringify(updatedContracts, null, 2)}\n`);

console.log('Ethereum Sepolia EmissionERC20 recorded:');
console.log(JSON.stringify(updatedContracts, null, 2));
