import { createWalletClient, formatUnits, http, parseAbi, type Address } from 'viem';
import { mainnet as ethereumMainnet, sepolia as ethereumSepolia } from 'viem/chains';
import { expectPositionalArgs, getPrimaryConfig, primaryRuntime } from '../common.js';
import {
  assertAddress,
  ethereumConfig,
  ethereumContracts,
  ethereumPublicClient,
  ethereumRpcUrl,
  getEthereumDeployerAccount,
} from './common.js';

expectPositionalArgs(0, 'npx tsx deployments/primary/scripts/ethereum/execute-emission.ts');

const emissionAbi = parseAbi([
  'function emission() external',
  'function nextEmissionIndex() view returns (uint256)',
]);
const erc20Abi = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
]);
const waitAfterEmissionMs = 120_000;
const chain = primaryRuntime.isTestnet ? ethereumSepolia : ethereumMainnet;
const weeksPerYear = 52n;
const totalPeriods = 1n + (20n * weeksPerYear);
const year0Emission = 1_723_466_646n;
const weeklyEmissionsByYear = [
  13_257_447n,
  12_171_771n,
  11_175_003n,
  10_259_862n,
  9_419_664n,
  8_648_271n,
  7_940_049n,
  7_289_824n,
  6_692_848n,
  6_144_758n,
  5_641_553n,
  5_179_556n,
  4_755_393n,
  4_365_966n,
  4_008_429n,
  3_680_172n,
  3_378_796n,
  3_102_100n,
  2_848_064n,
  2_614_832n,
];

type CnxBalances = {
  daoTreasury: bigint;
  relayWalletCold: bigint;
  emissionContract: bigint;
};

type ExpectedEmissionResult = {
  totalAmount: bigint;
  relayAmount: bigint;
  daoAmount: bigint;
  distributedAmount: bigint;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getTokenUnit(decimals: number): bigint {
  return 10n ** BigInt(decimals);
}

async function readCnxBalances(
  tokenAddress: Address,
  daoTreasuryAddress: Address,
  relayWalletColdAddress: Address,
  emissionContractAddress: Address,
): Promise<CnxBalances> {
  const [daoTreasury, relayWalletCold, emissionContract] = await Promise.all([
    ethereumPublicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [daoTreasuryAddress],
    }),
    ethereumPublicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [relayWalletColdAddress],
    }),
    ethereumPublicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [emissionContractAddress],
    }),
  ]);

  return { daoTreasury, relayWalletCold, emissionContract };
}

function getYearIndex(periodIndex: bigint): bigint {
  if (periodIndex >= totalPeriods) {
    throw new Error(`Emission period index ${periodIndex.toString()} exceeds the tokenomics schedule.`);
  }

  if (periodIndex === 0n) {
    return 0n;
  }

  return ((periodIndex - 1n) / weeksPerYear) + 1n;
}

function getNominalEmissionAmount(periodIndex: bigint): bigint {
  const yearIndex = getYearIndex(periodIndex);

  if (yearIndex === 0n) {
    return year0Emission;
  }

  const weeklyEmission = weeklyEmissionsByYear[Number(yearIndex - 1n)];

  if (weeklyEmission === undefined) {
    throw new Error(`No tokenomics emission amount is defined for year ${yearIndex.toString()}.`);
  }

  return weeklyEmission;
}

function getExpectedEmissionResult(periodIndex: bigint, tokenUnit: bigint, initCostCNX: number): ExpectedEmissionResult {
  const yearIndex = getYearIndex(periodIndex);
  const nominalEmissionAmount = getNominalEmissionAmount(periodIndex);
  const totalAmount = nominalEmissionAmount * tokenUnit;
  const daoPercent = yearIndex <= 1 ? 30n : 20n;
  const daoShareBeforeInitCost = (totalAmount * daoPercent) / 100n;
  const initCostAmount = periodIndex === 0n ? BigInt(initCostCNX) * tokenUnit : 0n;

  if (initCostAmount > daoShareBeforeInitCost) {
    throw new Error(`Configured initCostCNX ${initCostCNX.toString()} exceeds the first DAO treasury share.`);
  }

  const daoAmount = daoShareBeforeInitCost - initCostAmount;
  const relayAmount = totalAmount - daoShareBeforeInitCost;

  return {
    totalAmount,
    relayAmount,
    daoAmount,
    distributedAmount: relayAmount + daoAmount,
  };
}

function getExpectedEmissionContractBalance(periodIndex: bigint, tokenUnit: bigint, initCostCNX: number): bigint {
  if (periodIndex > totalPeriods) {
    throw new Error(`Emission period index ${periodIndex.toString()} exceeds the tokenomics schedule.`);
  }

  let expectedBalance = 0n;

  for (let index = periodIndex; index < totalPeriods; index += 1n) {
    expectedBalance += getNominalEmissionAmount(index) * tokenUnit;
  }

  if (periodIndex === 0n) {
    expectedBalance -= BigInt(initCostCNX) * tokenUnit;
  }

  return expectedBalance;
}

function getBalanceReport(address: Address, before: bigint, after: bigint, expectedDelta: bigint, decimals: number) {
  const actualDelta = after - before;
  const expectedAfter = before + expectedDelta;

  return {
    address,
    before: formatUnits(before, decimals),
    after: formatUnits(after, decimals),
    actualDelta: formatUnits(actualDelta, decimals),
    expectedDelta: formatUnits(expectedDelta, decimals),
    expectedAfter: formatUnits(expectedAfter, decimals),
    matchesExpected: after === expectedAfter,
  };
}

function getEmissionContractBalanceCheck(address: Address, actual: bigint, expected: bigint, decimals: number) {
  return {
    address,
    actual: formatUnits(actual, decimals),
    expected: formatUnits(expected, decimals),
    matchesExpected: actual === expected,
  };
}

const tokenAddress = assertAddress(ethereumContracts.crynuxTokenAddress, 'contracts.crynuxTokenAddress');
const emissionContractAddress = assertAddress(ethereumContracts.emissionContractAddress, 'contracts.emissionContractAddress');
const primaryConfig = await getPrimaryConfig();
const daoTreasuryAddress = assertAddress(primaryConfig.daoTreasuryAddress, 'primary.common.daoTreasuryAddress');
const relayWalletColdAddress = assertAddress(primaryConfig.relayWalletColdAddress, 'primary.common.relayWalletColdAddress');
const account = await getEthereumDeployerAccount();
const walletClient = createWalletClient({
  account,
  chain,
  transport: http(ethereumRpcUrl),
});

const nextEmissionIndex = await ethereumPublicClient.readContract({
  address: emissionContractAddress,
  abi: emissionAbi,
  functionName: 'nextEmissionIndex',
});
const latestBlock = await ethereumPublicClient.getBlock();
const [tokenDecimals, balancesBefore] = await Promise.all([
  ethereumPublicClient.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'decimals',
  }),
  readCnxBalances(tokenAddress, daoTreasuryAddress, relayWalletColdAddress, emissionContractAddress),
]);
const tokenUnit = getTokenUnit(tokenDecimals);
const nextEmissionIsInSchedule = nextEmissionIndex < totalPeriods;
const yearIndex = nextEmissionIsInSchedule ? getYearIndex(nextEmissionIndex) : undefined;
const expectedEmission = nextEmissionIsInSchedule
  ? getExpectedEmissionResult(nextEmissionIndex, tokenUnit, ethereumConfig.emission.initCostCNX)
  : undefined;
const expectedEmissionContractBalance = getExpectedEmissionContractBalance(
  nextEmissionIndex,
  tokenUnit,
  ethereumConfig.emission.initCostCNX,
);

console.log(`${primaryRuntime.names.ethereum} emission execution state:`);
console.log(
  JSON.stringify(
    {
      account: account.address,
      emissionContract: emissionContractAddress,
      nextEmissionIndex: nextEmissionIndex.toString(),
      executedPeriodIndex: nextEmissionIndex.toString(),
      yearIndex: yearIndex?.toString() ?? 'completed',
      expectedSource: 'crynux-tokenomics.md',
      latestBlockTimestamp: latestBlock.timestamp.toString(),
      balancesBefore: {
        daoTreasury: {
          address: daoTreasuryAddress,
          balance: formatUnits(balancesBefore.daoTreasury, tokenDecimals),
        },
        relayWalletCold: {
          address: relayWalletColdAddress,
          balance: formatUnits(balancesBefore.relayWalletCold, tokenDecimals),
        },
        emissionContract: {
          address: emissionContractAddress,
          balance: formatUnits(balancesBefore.emissionContract, tokenDecimals),
          expectedBalance: formatUnits(expectedEmissionContractBalance, tokenDecimals),
          matchesExpected: balancesBefore.emissionContract === expectedEmissionContractBalance,
        },
      },
      expectedDistribution: expectedEmission === undefined
        ? 'completed'
        : {
            totalAmount: formatUnits(expectedEmission.totalAmount, tokenDecimals),
            initCostDeductedFromDaoTreasury: formatUnits(
              nextEmissionIndex === 0n ? BigInt(ethereumConfig.emission.initCostCNX) * tokenUnit : 0n,
              tokenDecimals,
            ),
            daoTreasuryDelta: formatUnits(expectedEmission.daoAmount, tokenDecimals),
            relayWalletColdDelta: formatUnits(expectedEmission.relayAmount, tokenDecimals),
            emissionContractDelta: formatUnits(-expectedEmission.distributedAmount, tokenDecimals),
          },
    },
    null,
    2,
  ),
);

let hash: `0x${string}`;

try {
  hash = await walletClient.writeContract({
    address: emissionContractAddress,
    abi: emissionAbi,
    functionName: 'emission',
  });
} catch (error) {
  console.log('No executable emission is available. The emission contract rejected the call.');
  if (error instanceof Error) {
    console.log(error.message);
  }

  const emissionContractBalanceCheck = getEmissionContractBalanceCheck(
    emissionContractAddress,
    balancesBefore.emissionContract,
    expectedEmissionContractBalance,
    tokenDecimals,
  );

  console.log(`${primaryRuntime.names.ethereum} emission contract CNX balance check:`);
  console.log(
    JSON.stringify(
      {
        nextEmissionIndex: nextEmissionIndex.toString(),
        expectedSource: 'crynux-tokenomics.md',
        emissionContract: emissionContractBalanceCheck,
        result: emissionContractBalanceCheck.matchesExpected ? 'correct' : 'incorrect',
      },
      null,
      2,
    ),
  );

  if (!emissionContractBalanceCheck.matchesExpected) {
    throw new Error(`${primaryRuntime.names.ethereum} emission contract balance does not match the expected tokenomics remainder.`);
  }

  process.exit(0);
  throw error;
}

if (expectedEmission === undefined) {
  throw new Error(`${primaryRuntime.names.ethereum} emission transaction succeeded after the tokenomics schedule was completed.`);
}

const transactionReceipt = await ethereumPublicClient.waitForTransactionReceipt({ hash });

console.log(`Waiting ${waitAfterEmissionMs / 1000} seconds before reading updated emission state.`);
await sleep(waitAfterEmissionMs);

const updatedNextEmissionIndex = await ethereumPublicClient.readContract({
  address: emissionContractAddress,
  abi: emissionAbi,
  functionName: 'nextEmissionIndex',
});
const balancesAfter = await readCnxBalances(tokenAddress, daoTreasuryAddress, relayWalletColdAddress, emissionContractAddress);
const nextEmissionIndexMatches = updatedNextEmissionIndex === nextEmissionIndex + 1n;
const daoTreasuryReport = getBalanceReport(
  daoTreasuryAddress,
  balancesBefore.daoTreasury,
  balancesAfter.daoTreasury,
  expectedEmission.daoAmount,
  tokenDecimals,
);
const relayWalletColdReport = getBalanceReport(
  relayWalletColdAddress,
  balancesBefore.relayWalletCold,
  balancesAfter.relayWalletCold,
  expectedEmission.relayAmount,
  tokenDecimals,
);
const emissionContractReport = getBalanceReport(
  emissionContractAddress,
  balancesBefore.emissionContract,
  balancesAfter.emissionContract,
  -expectedEmission.distributedAmount,
  tokenDecimals,
);
const emissionResultIsCorrect = nextEmissionIndexMatches
  && daoTreasuryReport.matchesExpected
  && relayWalletColdReport.matchesExpected
  && emissionContractReport.matchesExpected;
const balanceChangesMatchExpected = daoTreasuryReport.matchesExpected
  && relayWalletColdReport.matchesExpected
  && emissionContractReport.matchesExpected;

console.log(`${primaryRuntime.names.ethereum} emission transaction receipt:`);
console.log(JSON.stringify(transactionReceipt, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2));
console.log(`${primaryRuntime.names.ethereum} post-emission CNX balance check:`);
console.log(
  JSON.stringify(
    {
      executedPeriodIndex: nextEmissionIndex.toString(),
      nextEmissionIndex: {
        before: nextEmissionIndex.toString(),
        after: updatedNextEmissionIndex.toString(),
        expectedAfter: (nextEmissionIndex + 1n).toString(),
        matchesExpected: nextEmissionIndexMatches,
      },
      daoTreasury: daoTreasuryReport,
      relayWalletCold: relayWalletColdReport,
      emissionContract: emissionContractReport,
      balanceChangesMatchExpected,
      result: emissionResultIsCorrect ? 'correct' : 'incorrect',
    },
    null,
    2,
  ),
);

if (!emissionResultIsCorrect) {
  throw new Error(`${primaryRuntime.names.ethereum} post-emission balances do not match the expected emission result.`);
}
