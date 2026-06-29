import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatUnits, isAddress, parseAbi, parseUnits, type Address } from 'viem';
import { expectAtLeastPositionalArgs, primaryRuntime } from '../common.js';
import { basePublicClient, bridgedCrynuxToken, getBaseCrynuxTokenAddress, getBaseDeployerWalletClient } from './common.js';

const erc20Abi = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address to,uint256 amount) returns (bool)',
]);
const defaultCsvPath = fileURLToPath(new URL('../../../../data/batch-cnx-transfers-on-base.csv', import.meta.url));
const skippedContractsPath = fileURLToPath(new URL('../../../../data/skipped-contracts-on-base.txt', import.meta.url));
const balanceCheckWaitMs = 5_000;
const httpRetryWaitMs = 5_000;
const maxHttpRetryCount = 5;

type TransferRow = {
  rowNumber: number;
  address: Address;
  amount: bigint;
  balanceText: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

const [csvPathInput, ...extraArgs] = expectAtLeastPositionalArgs(
  0,
  'npx tsx deployments/primary/scripts/base/batch-transfer-cns.ts [csvPath] [--force]',
  ['--force'],
);
const force = primaryRuntime.optionArgs.includes('--force');

if (extraArgs.length > 0) {
  throw new Error(
    'Usage: npx tsx deployments/primary/scripts/base/batch-transfer-cns.ts [csvPath] [--force] --network=<testnet|mainnet>',
  );
}

const csvPath = resolve(csvPathInput ?? defaultCsvPath);
const rows = await loadTransferRows(csvPath);
const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0n);
const baseCrynuxTokenAddress = getBaseCrynuxTokenAddress();
const walletClient = await getBaseDeployerWalletClient();
const account = walletClient.account;

if (account === undefined) {
  throw new Error(`${primaryRuntime.names.base} deployer account is required.`);
}

const senderBalance = await readCnxBalance(account.address);

if (senderBalance < totalAmount) {
  throw new Error(
    `Insufficient ${primaryRuntime.names.base} CNX balance. Required ${formatUnits(totalAmount, bridgedCrynuxToken.decimals)}, available ${formatUnits(senderBalance, bridgedCrynuxToken.decimals)}.`,
  );
}

console.log(`${primaryRuntime.names.base} CNX batch transfer:`);
console.log(
  JSON.stringify(
    {
      csvPath,
      network: primaryRuntime.network,
      sender: account.address,
      rowCount: rows.length,
      totalAmount: formatUnits(totalAmount, bridgedCrynuxToken.decimals),
      senderBalance: formatUnits(senderBalance, bridgedCrynuxToken.decimals),
    },
    null,
    2,
  ),
);

for (const row of rows) {
  console.log(`Processing row ${row.rowNumber}: ${formatUnits(row.amount, bridgedCrynuxToken.decimals)} CNX to ${row.address}`);

  if (!force && await isRecipientContract(row.address)) {
    await appendSkippedContractRow(row);
    console.log(`Skipping row ${row.rowNumber}: ${row.address} is a contract address.`);
    continue;
  }

  const balanceBefore = await readCnxBalance(row.address);
  if (!force && balanceBefore !== 0n) {
    throw new Error(
      `Transfer CSV row ${row.rowNumber} recipient balance must be zero before transfer. Current balance: ${formatUnits(balanceBefore, bridgedCrynuxToken.decimals)} CNX.`,
    );
  }

  await transferRowWithHttpRetry(row, balanceBefore);
}

const senderBalanceAfter = await readCnxBalance(account.address);
console.log(`${primaryRuntime.names.base} CNX batch transfer completed.`);
console.log(
  JSON.stringify(
    {
      sender: account.address,
      senderBalanceAfter: formatUnits(senderBalanceAfter, bridgedCrynuxToken.decimals),
    },
    null,
    2,
  ),
);

async function readCnxBalance(address: Address): Promise<bigint> {
  return basePublicClient.readContract({
    address: baseCrynuxTokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address],
  });
}

async function transferRowWithHttpRetry(row: TransferRow, balanceBefore: bigint): Promise<void> {
  const expectedBalanceAfter = balanceBefore + row.amount;

  for (let retryCount = 0; ; retryCount += 1) {
    try {
      await transferRow(row, expectedBalanceAfter);
      return;
    } catch (error) {
      if (!isRetryableHttpError(error) || retryCount >= maxHttpRetryCount) {
        throw new Error(`Transfer row ${row.rowNumber} failed. Batch stopped: ${getErrorMessage(error)}`);
      }

      console.log(
        `Transfer row ${row.rowNumber} hit an HTTP error. Waiting ${httpRetryWaitMs / 1000} seconds before retry ${retryCount + 1}/${maxHttpRetryCount}...`,
      );
      await sleep(httpRetryWaitMs);

      const balanceBeforeRetry = await readCnxBalance(row.address);
      if (balanceBeforeRetry === expectedBalanceAfter) {
        console.log(`Transfer row ${row.rowNumber} already completed before retry.`);
        return;
      }

      if (balanceBeforeRetry !== balanceBefore) {
        throw new Error(
          `Transfer row ${row.rowNumber} retry stopped because recipient balance is ${formatUnits(balanceBeforeRetry, bridgedCrynuxToken.decimals)} CNX, expected either ${formatUnits(balanceBefore, bridgedCrynuxToken.decimals)} or ${formatUnits(expectedBalanceAfter, bridgedCrynuxToken.decimals)} CNX.`,
        );
      }
    }
  }
}

async function transferRow(row: TransferRow, expectedBalanceAfter: bigint): Promise<void> {
  const hash = await walletClient.writeContract({
    address: baseCrynuxTokenAddress,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [row.address, row.amount],
  });
  console.log(`Transfer row ${row.rowNumber} submitted: ${hash}`);

  const receipt = await basePublicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    throw new Error(`Transaction failed: ${hash}`);
  }

  console.log(`Waiting ${balanceCheckWaitMs / 1000} seconds before checking row ${row.rowNumber} balance...`);
  await sleep(balanceCheckWaitMs);

  const balanceAfter = await readCnxBalance(row.address);
  if (balanceAfter !== expectedBalanceAfter) {
    throw new Error(
      `Transfer row ${row.rowNumber} balance verification failed. Expected ${formatUnits(expectedBalanceAfter, bridgedCrynuxToken.decimals)} CNX, got ${formatUnits(balanceAfter, bridgedCrynuxToken.decimals)} CNX.`,
    );
  }

  console.log(`Transfer row ${row.rowNumber} confirmed: ${hash}`);
}

async function isRecipientContract(address: Address): Promise<boolean> {
  const bytecode = await basePublicClient.getBytecode({ address });
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

  const balance = parseUnits(balanceText, bridgedCrynuxToken.decimals);
  if (balance <= 0n) {
    throw new Error(`Transfer CSV row ${rowNumber} balance must be greater than zero.`);
  }
  return { amount: balance, balanceText };
}
