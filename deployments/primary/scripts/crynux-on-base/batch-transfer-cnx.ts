import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createWalletClient, formatUnits, http, isAddress, parseAbi, parseUnits, type Address } from 'viem';
import { expectAtLeastPositionalArgs, primaryRuntime } from '../common.js';
import { deploymentConfig, deploymentContracts, getDeployerAccount, orbitChain, orbitChainPublicClient, orbitChainRpcUrl } from './common.js';

const defaultCsvPath = fileURLToPath(new URL('../../../../data/batch-l2-cnx-transfers.csv', import.meta.url));
const skippedContractsPath = fileURLToPath(new URL('../../../../data/skipped-contracts-on-l2.txt', import.meta.url));
const balanceCheckWaitMs = 5_000;
const httpRetryWaitMs = 5_000;
const maxHttpRetryCount = 5;
const postTransferBalanceTolerance = parseUnits('0.01', 18);
const nodeStakingAbi = parseAbi([
  'function getStakingInfo(address) view returns ((address,uint256,uint256,uint8,uint256))',
]);
const delegatedStakingAbi = parseAbi([
  'function getDelegatorTotalStakeAmount(address delegatorAddress) view returns (uint256)',
]);

type TransferRow = {
  rowNumber: number;
  address: Address;
  amount: bigint;
  balanceText: string;
};

type RecipientBalances = {
  wallet: bigint;
  nodeStaking: bigint;
  delegatedStaking: bigint;
  total: bigint;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

const [csvPathInput, ...extraArgs] = expectAtLeastPositionalArgs(
  0,
  'npx tsx deployments/primary/scripts/crynux-on-base/batch-transfer-cnx.ts [csvPath] [--force]',
  ['--force'],
);
const force = primaryRuntime.optionArgs.includes('--force');

if (extraArgs.length > 0) {
  throw new Error(
    'Usage: npx tsx deployments/primary/scripts/crynux-on-base/batch-transfer-cnx.ts [csvPath] [--force] --network=<testnet|mainnet>',
  );
}

const csvPath = resolve(csvPathInput ?? defaultCsvPath);
const rows = await loadTransferRows(csvPath);
const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0n);
const nodeContracts = getRequiredNodeContracts();
const deployer = await getDeployerAccount();
const walletClient = createWalletClient({
  account: deployer,
  chain: orbitChain,
  transport: http(orbitChainRpcUrl),
});
const balanceBefore = await orbitChainPublicClient.getBalance({ address: deployer.address });

if (balanceBefore < totalAmount) {
  throw new Error(
    `Insufficient ${deploymentConfig.name} CNX balance. Required ${formatUnits(totalAmount, 18)}, available ${formatUnits(balanceBefore, 18)}.`,
  );
}

console.log(`${deploymentConfig.name} batch transfer:`);
console.log(
  JSON.stringify(
    {
      csvPath,
      network: primaryRuntime.network,
      sender: deployer.address,
      rowCount: rows.length,
      totalAmount: formatUnits(totalAmount, 18),
      balanceBefore: formatUnits(balanceBefore, 18),
      force,
    },
    null,
    2,
  ),
);

for (const row of rows) {
  console.log(`Processing row ${row.rowNumber}: ${formatUnits(row.amount, 18)} CNX to ${row.address}`);

  if (!force && await isRecipientContract(row.address)) {
    await appendSkippedContractRow(row);
    console.log(`Skipping row ${row.rowNumber}: ${row.address} is a contract address.`);
    continue;
  }

  const recipientBalancesBefore = await readRecipientBalances(row.address);
  if (isTransferVerified(recipientBalancesBefore.total, row.amount)) {
    console.log(`Skipping row ${row.rowNumber}: recipient total balance already matches the transfer amount.`);
    continue;
  }
  if (!force && recipientBalancesBefore.total !== 0n) {
    throw new Error(
      `Transfer CSV row ${row.rowNumber} recipient total balance must be zero before transfer. Current balances: ${formatRecipientBalances(recipientBalancesBefore)}.`,
    );
  }

  await transferRowWithHttpRetry(row, recipientBalancesBefore.total, recipientBalancesBefore.total + row.amount);
}

const balanceAfter = await orbitChainPublicClient.getBalance({ address: deployer.address });
console.log(`${deploymentConfig.name} batch transfer completed.`);
console.log(
  JSON.stringify(
    {
      sender: deployer.address,
      balanceAfter: formatUnits(balanceAfter, 18),
    },
    null,
    2,
  ),
);

async function readNativeBalance(address: Address): Promise<bigint> {
  return orbitChainPublicClient.getBalance({ address });
}

async function readRecipientBalances(address: Address): Promise<RecipientBalances> {
  const [wallet, stakingInfo, delegatedStaking] = await Promise.all([
    readNativeBalance(address),
    orbitChainPublicClient.readContract({
      address: nodeContracts.nodeStaking,
      abi: nodeStakingAbi,
      functionName: 'getStakingInfo',
      args: [address],
    }),
    orbitChainPublicClient.readContract({
      address: nodeContracts.delegatedStaking,
      abi: delegatedStakingAbi,
      functionName: 'getDelegatorTotalStakeAmount',
      args: [address],
    }),
  ]);
  const nodeStaking = getNodeStakingAmount(stakingInfo);

  return {
    wallet,
    nodeStaking,
    delegatedStaking,
    total: wallet + nodeStaking + delegatedStaking,
  };
}

async function transferRowWithHttpRetry(row: TransferRow, recipientTotalBefore: bigint, expectedRecipientTotalAfter: bigint): Promise<void> {
  for (let retryCount = 0; ; retryCount += 1) {
    try {
      await transferRow(row, expectedRecipientTotalAfter);
      return;
    } catch (error) {
      if (!isRetryableHttpError(error) || retryCount >= maxHttpRetryCount) {
        throw new Error(`Transfer row ${row.rowNumber} failed. Batch stopped: ${getErrorMessage(error)}`);
      }

      console.log(
        `Transfer row ${row.rowNumber} hit an HTTP error. Waiting ${httpRetryWaitMs / 1000} seconds before retry ${retryCount + 1}/${maxHttpRetryCount}...`,
      );
      await sleep(httpRetryWaitMs);

      const balancesBeforeRetry = await readRecipientBalances(row.address);
      if (isTransferVerified(balancesBeforeRetry.total, expectedRecipientTotalAfter)) {
        console.log(`Transfer row ${row.rowNumber} already completed before retry.`);
        return;
      }

      if (!isRetryableRecipientTotal(balancesBeforeRetry.total, recipientTotalBefore)) {
        throw new Error(
          `Transfer row ${row.rowNumber} retry stopped because recipient total balance does not match the pre-transfer or expected post-transfer total. Current balances: ${formatRecipientBalances(balancesBeforeRetry)}, pre-transfer total=${formatUnits(recipientTotalBefore, 18)} CNX, expected post-transfer total=${formatUnits(expectedRecipientTotalAfter, 18)} CNX.`,
        );
      }
    }
  }
}

async function transferRow(row: TransferRow, expectedRecipientTotalAfter: bigint): Promise<void> {
  const hash = await walletClient.sendTransaction({
    to: row.address,
    value: row.amount,
  });
  console.log(`Transfer row ${row.rowNumber} submitted: ${hash}`);

  const receipt = await orbitChainPublicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    throw new Error(`Transaction failed: ${hash}`);
  }

  console.log(`Waiting ${balanceCheckWaitMs / 1000} seconds before checking row ${row.rowNumber} balance...`);
  await sleep(balanceCheckWaitMs);

  const balancesAfter = await readRecipientBalances(row.address);
  if (!isTransferVerified(balancesAfter.total, expectedRecipientTotalAfter)) {
    throw new Error(
      `Transfer row ${row.rowNumber} balance verification failed. Expected ${formatUnits(expectedRecipientTotalAfter, 18)} CNX total, got ${formatRecipientBalances(balancesAfter)}.`,
    );
  }

  console.log(`Transfer row ${row.rowNumber} confirmed: ${hash}`);
}

function getRequiredNodeContracts(): NonNullable<typeof deploymentContracts.nodeContracts> {
  if (deploymentContracts.nodeContracts === undefined) {
    throw new Error(`${deploymentConfig.name} node contracts are required.`);
  }

  return deploymentContracts.nodeContracts;
}

function getNodeStakingAmount(stakingInfo: unknown): bigint {
  if (!Array.isArray(stakingInfo) || stakingInfo.length < 3) {
    throw new Error('Node staking info must be a tuple.');
  }

  return BigInt(stakingInfo[1] as bigint) + BigInt(stakingInfo[2] as bigint);
}

function isTransferVerified(actualTotal: bigint, expectedTotal: bigint): boolean {
  return getAbsDiff(actualTotal, expectedTotal) <= postTransferBalanceTolerance;
}

function isRetryableRecipientTotal(actualTotal: bigint, expectedTotal: bigint): boolean {
  if (force) {
    return isTransferVerified(actualTotal, expectedTotal);
  }

  return actualTotal === expectedTotal;
}

function getAbsDiff(left: bigint, right: bigint): bigint {
  return left >= right ? left - right : right - left;
}

function formatRecipientBalances(balances: RecipientBalances): string {
  return [
    `wallet=${formatUnits(balances.wallet, 18)} CNX`,
    `node_staking=${formatUnits(balances.nodeStaking, 18)} CNX`,
    `delegated_staking=${formatUnits(balances.delegatedStaking, 18)} CNX`,
    `total=${formatUnits(balances.total, 18)} CNX`,
  ].join(', ');
}

async function isRecipientContract(address: Address): Promise<boolean> {
  const bytecode = await orbitChainPublicClient.getBytecode({ address });
  return bytecode !== undefined && bytecode !== '0x' && !isEip7702DelegationDesignator(bytecode);
}

async function appendSkippedContractRow(row: TransferRow): Promise<void> {
  await appendFile(skippedContractsPath, `${row.address},${row.balanceText}\n`);
}

function isEip7702DelegationDesignator(bytecode: string): boolean {
  return /^0xef0100[0-9a-fA-F]{40}$/.test(bytecode);
}

function isRetryableHttpError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes('http request failed') ||
    message.includes('fetch failed') ||
    message.includes('request timed out') ||
    message.includes('too long to respond') ||
    message.includes('the request timed out')
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function loadTransferRows(inputPath: string): Promise<TransferRow[]> {
  const parsedRows = parseCsv(await readFile(inputPath, 'utf8'));

  if (parsedRows.length === 0) {
    throw new Error('Transfer CSV file is empty.');
  }

  const headers = normalizeCsvHeaders(parsedRows[0]);
  const addressIndex = getRequiredCsvColumn(headers, 'address');
  const balanceIndex = getRequiredCsvColumn(headers, 'balance');
  const rows = parsedRows
    .slice(1)
    .map((row, index) => ({ row, rowNumber: index + 2 }))
    .filter(({ row }) => row.some((value) => value.trim() !== ''))
    .map(({ row, rowNumber }) => ({
      rowNumber,
      address: parseTransferAddress(row[addressIndex], rowNumber),
      ...parseTransferBalance(row[balanceIndex], rowNumber),
    }));

  if (rows.length === 0) {
    throw new Error('Transfer CSV file does not contain any transfer rows.');
  }

  return rows;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let index = 0; index < normalizedText.length; index += 1) {
    const char = normalizedText[index];

    if (char === '"') {
      if (inQuotes && normalizedText[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }

    if (char === '\n' && !inQuotes) {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }

    field += char;
  }

  if (inQuotes) {
    throw new Error('CSV contains an unterminated quoted field.');
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function normalizeCsvHeaders(row: string[]): string[] {
  return row.map((header, index) => (index === 0 ? header.replace(/^\uFEFF/, '') : header).trim());
}

function getRequiredCsvColumn(headers: string[], columnName: string): number {
  const index = headers.indexOf(columnName);
  if (index === -1) {
    throw new Error(`CSV is missing required column: ${columnName}`);
  }
  return index;
}

function parseTransferAddress(value: string | undefined, rowNumber: number): Address {
  const address = value?.trim() ?? '';
  if (!isAddress(address)) {
    throw new Error(`Transfer CSV row ${rowNumber} address must be a valid EVM address.`);
  }
  return address;
}

function parseTransferBalance(value: string | undefined, rowNumber: number): { amount: bigint; balanceText: string } {
  const balanceText = (value?.trim() ?? '').replace(/\s*CNX$/i, '').trim();
  if (!/^\d+(\.\d{1,18})?$/.test(balanceText)) {
    throw new Error(`Transfer CSV row ${rowNumber} balance must be a positive CNX amount with up to 18 decimal places.`);
  }

  const amount = parseUnits(balanceText, 18);
  if (amount <= 0n) {
    throw new Error(`Transfer CSV row ${rowNumber} balance must be greater than zero.`);
  }
  return { amount, balanceText };
}
