import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createWalletClient, formatUnits, http, parseAbi } from 'viem';
import { mainnet as ethereumMainnet, sepolia as ethereumSepolia } from 'viem/chains';
import {
  buildPrimaryCacheFileName,
  buildPrimaryDeploymentId,
  getPrimaryConfig,
  getPrimaryLayerFile,
  primaryRuntime,
  run,
  expectPositionalArgs,
} from '../common.js';
import {
  assertAddress,
  ethereumConfig,
  ethereumContracts,
  ethereumPublicClient,
  ethereumRpcUrl,
  getEthereumDeployerAccount,
  type EthereumContracts,
} from './common.js';

expectPositionalArgs(0, 'npx tsx deployments/primary/scripts/ethereum/deploy-emission.ts');

const emissionParamsPath = resolve('cache', buildPrimaryCacheFileName('primary-deploy-emission-erc20-params'));
const contractsFile = getPrimaryLayerFile('ethereum', 'contracts.json');
const deploymentId = buildPrimaryDeploymentId('deploy-emission-erc20');
const ignitionAddressesFile = resolve('ignition', 'deployments', deploymentId, 'deployed_addresses.json');
const ignitionAddressKeys = ['DeployEmissionErc20#EmissionERC20', 'DeployEmissionErc20#emissionERC20'];
const cnxTotalSupply = 8_617_333_262n;
const cnxTokenUnit = 10n ** 18n;
const erc20Abi = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address to,uint256 amount) returns (bool)',
]);
const chain = primaryRuntime.isTestnet ? ethereumSepolia : ethereumMainnet;
const fundingBalanceCheckWaitMs = 120_000;

function getDeployedAddress(deployedAddresses: Record<string, string>): string {
  for (const key of ignitionAddressKeys) {
    const address = deployedAddresses[key];

    if (address !== undefined) {
      return address;
    }
  }

  throw new Error(`Could not find EmissionERC20 in ${ignitionAddressesFile}.`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getFundingAmountWei(initCostCNX: number): bigint {
  return (cnxTotalSupply - BigInt(initCostCNX)) * cnxTokenUnit;
}

function getInitCostWei(initCostCNX: number): bigint {
  return BigInt(initCostCNX) * cnxTokenUnit;
}

const primaryConfig = await getPrimaryConfig();

if (ethereumContracts.crynuxTokenAddress === '') {
  console.log(`Deploy the canonical ${primaryRuntime.names.ethereum} CNX token first:`);
  console.log('npx tsx deployments/primary/scripts/ethereum/deploy-token.ts --network=<testnet|mainnet>');
  process.exit(0);
}

if (ethereumContracts.emissionContractAddress !== '') {
  console.log(`${primaryRuntime.names.ethereum} EmissionERC20 is already recorded. Skipping deployment.`);
  console.log(JSON.stringify(ethereumContracts, null, 2));
  process.exit(0);
}

const tokenAddress = assertAddress(ethereumContracts.crynuxTokenAddress, 'contracts.crynuxTokenAddress');
assertAddress(primaryConfig.daoTreasuryAddress, 'primary.common.daoTreasuryAddress');
assertAddress(primaryConfig.relayWalletColdAddress, 'primary.common.relayWalletColdAddress');

const emissionParams = {
  DeployEmissionErc20: {
    tokenAddress,
    mode: ethereumConfig.emission.mode,
    daoTreasuryAddress: primaryConfig.daoTreasuryAddress,
    relayWalletColdAddress: primaryConfig.relayWalletColdAddress,
    startTimestamp: ethereumConfig.emission.startTimestamp,
    initialEmissionIndex: ethereumConfig.emission.initialEmissionIndex,
    initCostCNX: ethereumConfig.emission.initCostCNX,
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
  primaryRuntime.hardhatNetworks.ethereum,
  '--parameters',
  emissionParamsPath,
]);

const deployedAddresses = JSON.parse(await readFile(ignitionAddressesFile, 'utf8')) as Record<string, string>;
const emissionContractAddress = assertAddress(getDeployedAddress(deployedAddresses), 'ignition.EmissionERC20');
const fundingAmountWei = getFundingAmountWei(ethereumConfig.emission.initCostCNX);
const initCostWei = getInitCostWei(ethereumConfig.emission.initCostCNX);
const account = await getEthereumDeployerAccount();
const emissionContractBalance = await ethereumPublicClient.readContract({
  address: tokenAddress,
  abi: erc20Abi,
  functionName: 'balanceOf',
  args: [emissionContractAddress],
});

if (emissionContractBalance < fundingAmountWei) {
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(ethereumRpcUrl),
  });
  const fundingDelta = fundingAmountWei - emissionContractBalance;
  const deployerBalance = await ethereumPublicClient.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [account.address],
  });

  if (deployerBalance < fundingDelta) {
    throw new Error(`Insufficient deployer CNX balance. Required ${formatUnits(fundingDelta, 18)}, available ${formatUnits(deployerBalance, 18)}.`);
  }

  const fundingHash = await walletClient.writeContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [emissionContractAddress, fundingDelta],
  });
  const fundingReceipt = await ethereumPublicClient.waitForTransactionReceipt({ hash: fundingHash });

  console.log(`${primaryRuntime.names.ethereum} EmissionERC20 funding transaction receipt:`);
  console.log(JSON.stringify(fundingReceipt, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2));
}

console.log(`Waiting ${fundingBalanceCheckWaitMs / 1000} seconds before checking post-funding balances.`);
await sleep(fundingBalanceCheckWaitMs);

const [updatedDeployerBalance, updatedEmissionContractBalance] = await Promise.all([
  ethereumPublicClient.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [account.address],
  }),
  ethereumPublicClient.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [emissionContractAddress],
  }),
]);

console.log(`${primaryRuntime.names.ethereum} post-funding CNX balances:`);
console.log(
  JSON.stringify(
    {
      deployer: {
        address: account.address,
        actual: formatUnits(updatedDeployerBalance, 18),
        expected: formatUnits(initCostWei, 18),
      },
      emissionContract: {
        address: emissionContractAddress,
        actual: formatUnits(updatedEmissionContractBalance, 18),
        expected: formatUnits(fundingAmountWei, 18),
      },
    },
    null,
    2,
  ),
);

if (updatedDeployerBalance !== initCostWei || updatedEmissionContractBalance !== fundingAmountWei) {
  throw new Error(`${primaryRuntime.names.ethereum} post-funding CNX balances do not match expected values.`);
}

const deployedAtBlockNumber = Number(await ethereumPublicClient.getBlockNumber());
const updatedContracts: EthereumContracts = {
  ...ethereumContracts,
  emissionContractAddress,
  deployedAtBlockNumber,
};

await writeFile(contractsFile, `${JSON.stringify(updatedContracts, null, 2)}\n`);

console.log(`${primaryRuntime.names.ethereum} EmissionERC20 recorded:`);
console.log(JSON.stringify(updatedContracts, null, 2));
