import { createWalletClient, formatUnits, getAddress, http, parseAbi, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  deploymentConfig,
  getConfiguredValidatorPrivateKey,
  getCoreContracts,
  parentChain,
  parentChainPublicClient,
  parentChainRpcUrl,
} from './common.js';

const erc20Abi = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]);

const approvalAmountText = '1';

const coreContracts = getCoreContracts();
const tokenAddress = deploymentConfig.l1CrynuxTokenAddress;
const validatorPrivateKey = await getConfiguredValidatorPrivateKey();
const validator = privateKeyToAccount(validatorPrivateKey);

if (getAddress(validator.address) !== getAddress(deploymentConfig.l2ValidatorAddress)) {
  throw new Error('L2_VALIDATOR_PRIVATE_KEY does not match config.json l2ValidatorAddress.');
}

const [symbol, decimals] = await Promise.all([
  parentChainPublicClient.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'symbol',
  }),
  parentChainPublicClient.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'decimals',
  }),
]);

const approvalAmount = parseUnits(approvalAmountText, decimals);
const [balance, allowance] = await Promise.all([
  parentChainPublicClient.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [validator.address],
  }),
  parentChainPublicClient.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [validator.address, coreContracts.rollup],
  }),
]);

console.log('Validator stake token approval state:');
console.log(
  JSON.stringify(
    {
      validator: validator.address,
      token: tokenAddress,
      symbol,
      decimals,
      rollup: coreContracts.rollup,
      approvalAmount: formatUnits(approvalAmount, decimals),
      balance: formatUnits(balance, decimals),
      allowance: formatUnits(allowance, decimals),
    },
    null,
    2,
  ),
);

if (allowance >= approvalAmount) {
  console.log('Allowance is already sufficient. Skipping approve transaction.');
  process.exit(0);
}

if (balance < approvalAmount) {
  throw new Error(`Validator balance is insufficient: have ${formatUnits(balance, decimals)} ${symbol}, need ${approvalAmountText} ${symbol}.`);
}

const validatorWalletClient = createWalletClient({
  account: validator,
  chain: parentChain,
  transport: http(parentChainRpcUrl),
});

const hash = await validatorWalletClient.writeContract({
  address: tokenAddress,
  abi: erc20Abi,
  functionName: 'approve',
  args: [coreContracts.rollup, approvalAmount],
});
const transactionReceipt = await parentChainPublicClient.waitForTransactionReceipt({ hash });
const updatedAllowance = await parentChainPublicClient.readContract({
  address: tokenAddress,
  abi: erc20Abi,
  functionName: 'allowance',
  args: [validator.address, coreContracts.rollup],
});

console.log('Approve transaction receipt:');
console.log(JSON.stringify(transactionReceipt, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2));
console.log(`Updated allowance: ${formatUnits(updatedAllowance, decimals)} ${symbol}`);
