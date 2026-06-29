import { API_BASE_URLS, type EvmUnsignedTransaction } from '@omni-bridge/core';
import { formatEther, parseAbi, parseUnits, type Hex } from 'viem';
import { primaryRuntime } from '../common.js';
import {
  bridgedCrynuxToken,
  ethereumBridgeBuilder,
  ethereumPublicClient,
  formatCnxAmount,
  getConfiguredNearDeployerAccountId,
  getEthereumCrynuxTokenAddress,
  getEthereumCrynuxTokenOmniAddress,
  getEthereumDeployerWalletClient,
  getNearCrynuxTokenAccountId,
  getNearTokenBalance,
  omniBridge,
  sendEthereumBridgeTransaction,
} from './common.js';

const pollingIntervalMs = 30_000;

const erc20Abi = parseAbi([
  'function allowance(address owner,address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
]);

type TransferStatusResponse = string[];
const nearFinalizedTransferStatuses = new Set([
  'Finalised',
  'FinalisedOnNear',
  'FastFinalisedOnNear',
]);

function getBridgeArgs(): { amount: bigint; recipientAccountId: string } {
  if (primaryRuntime.positionalArgs.length < 1 || primaryRuntime.positionalArgs.length > 2) {
    throw new Error('Usage: npx tsx deployments/primary/scripts/near/bridge-cnx-from-ethereum.ts <integer-cnx-amount> [near-recipient-account-id] --network=<testnet|mainnet>');
  }

  if (primaryRuntime.optionArgs.length > 0) {
    throw new Error(`Unsupported option: ${primaryRuntime.optionArgs[0]}.`);
  }

  const [amountArg, recipientAccountIdArg] = primaryRuntime.positionalArgs as [string, string?];

  if (!/^[1-9]\d*$/.test(amountArg)) {
    throw new Error('The CNX amount must be a positive integer.');
  }

  const recipientAccountId = recipientAccountIdArg ?? getConfiguredNearDeployerAccountId();

  if (!/^[a-z0-9._-]+$/.test(recipientAccountId)) {
    throw new Error('The NEAR recipient account ID contains unsupported characters.');
  }

  return {
    amount: parseUnits(amountArg, bridgedCrynuxToken.decimals),
    recipientAccountId,
  };
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return String(error);
}

function getBridgeCommand(): string {
  return [
    'npx tsx deployments/primary/scripts/near/bridge-cnx-from-ethereum.ts',
    ...primaryRuntime.positionalArgs,
    `--network=${primaryRuntime.network}`,
  ].join(' ');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function submitEthereumTransaction(stage: string, transaction: EvmUnsignedTransaction): Promise<Hex> {
  try {
    return await sendEthereumBridgeTransaction(transaction);
  } catch (error) {
    throw new Error([
      `${stage} transaction was not confirmed as submitted because no transaction hash was returned.`,
      'The script cannot prove that the transaction was broadcast.',
      `Check the ${primaryRuntime.names.ethereum} deployer account ${account?.address} in an explorer or wallet for a pending transaction.`,
      `If no pending transaction exists, rerun: ${getBridgeCommand()}`,
      `Original error: ${formatError(error)}`,
    ].join('\n'));
  }
}

async function waitForEthereumFinality(
  stage: string,
  receipt: Awaited<ReturnType<typeof ethereumPublicClient.waitForTransactionReceipt>>,
): Promise<void> {
  console.log(
    `Waiting for ${stage} transaction ${receipt.transactionHash} in block ${receipt.blockNumber} ` +
    `to become finalized on ${primaryRuntime.names.ethereum}.`,
  );

  while (true) {
    const finalizedBlock = await ethereumPublicClient.getBlock({ blockTag: 'finalized' });

    if (finalizedBlock.number >= receipt.blockNumber) {
      console.log(
        `${stage} transaction is finalized on ${primaryRuntime.names.ethereum}. ` +
        `Transaction block: ${receipt.blockNumber}; finalized block: ${finalizedBlock.number}.`,
      );
      return;
    }

    console.log(
      `${stage} transaction ${receipt.transactionHash} is not finalized yet. ` +
      `Transaction block: ${receipt.blockNumber}; finalized block: ${finalizedBlock.number}. ` +
      `Retrying in ${pollingIntervalMs / 1000} seconds.`,
    );

    await sleep(pollingIntervalMs);
  }
}

async function getTransferStatus(statusUrl: string): Promise<TransferStatusResponse> {
  const response = await fetch(statusUrl);

  if (!response.ok) {
    throw new Error(`Omni Bridge status request failed: ${response.status} ${await response.text()}`);
  }

  return await response.json() as TransferStatusResponse;
}

async function waitForTransferFinalized(statusUrl: string): Promise<TransferStatusResponse> {
  while (true) {
    const status = await getTransferStatus(statusUrl);

    console.log(`Omni Bridge transfer status: ${JSON.stringify(status)}`);

    if (status.some((entry) => nearFinalizedTransferStatuses.has(entry))) {
      return status;
    }

    console.log(`Transfer is not finalized yet. Retrying in ${pollingIntervalMs / 1000} seconds.`);
    await sleep(pollingIntervalMs);
  }
}

async function waitForEthereumReceipt(stage: string, hash: Hex, nextStep: string): Promise<Awaited<ReturnType<typeof ethereumPublicClient.waitForTransactionReceipt>>> {
  try {
    return await ethereumPublicClient.waitForTransactionReceipt({ hash });
  } catch (error) {
    throw new Error([
      `${stage} transaction was submitted, but the script could not confirm the receipt.`,
      `${stage} transaction hash: ${hash}`,
      nextStep,
      `Original error: ${formatError(error)}`,
    ].join('\n'));
  }
}

const { amount, recipientAccountId } = getBridgeArgs();
const ethereumCrynuxTokenAddress = getEthereumCrynuxTokenAddress();
const walletClient = await getEthereumDeployerWalletClient();
const account = walletClient.account;

if (account === undefined) {
  throw new Error(`${primaryRuntime.names.ethereum} deployer account is required.`);
}

const balance = await ethereumPublicClient.readContract({
  address: ethereumCrynuxTokenAddress,
  abi: erc20Abi,
  functionName: 'balanceOf',
  args: [account.address],
});

if (balance < amount) {
  throw new Error(`Insufficient ${primaryRuntime.names.ethereum} CNX balance. Required ${formatCnxAmount(amount)}, available ${formatCnxAmount(balance)}.`);
}

const sender = `eth:${account.address}` as const;
const recipient = `near:${recipientAccountId}` as const;
const relayerFeeQuote = await omniBridge.api.getFee(sender, recipient, getEthereumCrynuxTokenOmniAddress(), amount);
const tokenFee = BigInt(relayerFeeQuote.transferred_token_fee ?? 0);
const nativeFee = relayerFeeQuote.native_token_fee ?? 0n;
const receivedAmount = amount - tokenFee;
const nearCrynuxTokenAccountId = getNearCrynuxTokenAccountId();
const initialNearBalance = await getNearTokenBalance(nearCrynuxTokenAccountId, recipientAccountId);

console.log('Omni Bridge relayer fee quote:');
console.log(JSON.stringify(relayerFeeQuote, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2));
console.log('The quoted relayer fees will be included in the bridge transfer.');
console.log(`Initial ${primaryRuntime.names.near} CNX balance for ${recipientAccountId}: ${formatCnxAmount(initialNearBalance)} CNX`);

const allowance = await ethereumPublicClient.readContract({
  address: ethereumCrynuxTokenAddress,
  abi: erc20Abi,
  functionName: 'allowance',
  args: [account.address, ethereumBridgeBuilder.bridgeAddress],
});

if (allowance < amount) {
  const approveHash = await submitEthereumTransaction('Approve', ethereumBridgeBuilder.buildApproval(ethereumCrynuxTokenAddress, amount));
  const approveReceipt = await waitForEthereumReceipt(
    'Approve',
    approveHash,
    `After the approve transaction is confirmed, rerun: ${getBridgeCommand()}`,
  );

  console.log('Approve transaction receipt:');
  console.log(JSON.stringify(approveReceipt, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2));
}

const validatedTransfer = await omniBridge.validateTransfer({
  token: getEthereumCrynuxTokenOmniAddress(),
  amount,
  fee: tokenFee,
  nativeFee,
  sender,
  recipient,
});
const bridgeHash = await submitEthereumTransaction(`${primaryRuntime.names.ethereum} to ${primaryRuntime.names.near} bridge`, ethereumBridgeBuilder.buildTransfer(validatedTransfer));
const statusUrl = `${API_BASE_URLS[primaryRuntime.network]}/api/v3/transfers/transfer/status?transaction_hash=${bridgeHash}`;
const bridgeReceipt = await waitForEthereumReceipt(
  `${primaryRuntime.names.ethereum} to ${primaryRuntime.names.near} bridge`,
  bridgeHash,
  `Monitor relayer progress: ${statusUrl}`,
);

console.log(`${primaryRuntime.names.ethereum} to ${primaryRuntime.names.near} CNX bridge transaction receipt:`);
console.log(JSON.stringify(bridgeReceipt, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2));
console.log(`Native fee paid: ${formatEther(nativeFee)} ETH`);
console.log(`Transferred token fee: ${formatCnxAmount(tokenFee)} CNX`);
console.log(`Transfer status URL: ${statusUrl}`);

await waitForEthereumFinality(`${primaryRuntime.names.ethereum} to ${primaryRuntime.names.near} bridge`, bridgeReceipt);
const finalizedStatus = await waitForTransferFinalized(statusUrl);
const finalNearBalance = await getNearTokenBalance(nearCrynuxTokenAccountId, recipientAccountId);
const expectedNearBalance = initialNearBalance + receivedAmount;

if (finalNearBalance < expectedNearBalance) {
  throw new Error(
    `${primaryRuntime.names.near} CNX balance did not increase by the expected bridge amount. ` +
    `Expected at least ${formatCnxAmount(expectedNearBalance)} CNX, actual ${formatCnxAmount(finalNearBalance)} CNX.`,
  );
}

console.log(`Final Omni Bridge transfer status: ${JSON.stringify(finalizedStatus)}`);
console.log(`Final ${primaryRuntime.names.near} CNX balance for ${recipientAccountId}: ${formatCnxAmount(finalNearBalance)} CNX`);
