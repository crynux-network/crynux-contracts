import { createTokenBridgeFetchTokenBridgeContracts, fetchAllowance } from '@arbitrum/chain-sdk';
import {
  EthBridger,
  getArbitrumNetworkInformationFromRollup,
  registerCustomArbitrumNetwork,
  type ArbitrumNetwork,
} from '@arbitrum/sdk';
import { BigNumber } from '@ethersproject/bignumber';
import { JsonRpcProvider } from '@ethersproject/providers';
import { Wallet } from '@ethersproject/wallet';
import { formatUnits, parseAbi, parseUnits } from 'viem';
import {
  deploymentConfig,
  getConfiguredRollupDeployerPrivateKey,
  getCoreContracts,
  getRollupDeployerAccount,
  orbitChainPublicClient,
  orbitChainRpcUrl,
  parentChainPublicClient,
  parentChainRpcUrl,
} from './common.js';

const erc20Abi = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
]);

const depositAmountInput = process.argv[2];

if (depositAmountInput === undefined) {
  throw new Error('Usage: npx tsx deployments/base-sepolia/deposit-crynux-token-to-l2.ts <amount>');
}

const depositAmount = parseUnits(depositAmountInput, 18);

if (depositAmount <= 0n) {
  throw new Error('Deposit amount must be greater than zero.');
}

const rollupDeployer = await getRollupDeployerAccount();
const parentChainProvider = new JsonRpcProvider(parentChainRpcUrl);
const orbitChainProvider = new JsonRpcProvider(orbitChainRpcUrl);
const parentChainSigner = new Wallet(await getConfiguredRollupDeployerPrivateKey(), parentChainProvider);
const coreContracts = getCoreContracts();

const l1BalanceBefore = await parentChainPublicClient.readContract({
  address: deploymentConfig.l1CrynuxTokenAddress,
  abi: erc20Abi,
  functionName: 'balanceOf',
  args: [rollupDeployer.address],
});

if (l1BalanceBefore < depositAmount) {
  throw new Error(
    `Insufficient L1 CNX balance. Required ${formatUnits(depositAmount, 18)}, available ${formatUnits(l1BalanceBefore, 18)}.`,
  );
}

const arbitrumNetworkInformation = await getArbitrumNetworkInformationFromRollup(coreContracts.rollup, parentChainProvider);
const tokenBridgeContracts = await createTokenBridgeFetchTokenBridgeContracts({
  inbox: coreContracts.inbox,
  parentChainPublicClient,
});
const arbitrumNetwork: ArbitrumNetwork = {
  name: 'Crynux on Base Sepolia',
  chainId: deploymentConfig.l2ChainId,
  parentChainId: arbitrumNetworkInformation.parentChainId,
  confirmPeriodBlocks: arbitrumNetworkInformation.confirmPeriodBlocks,
  ethBridge: arbitrumNetworkInformation.ethBridge,
  isCustom: true,
  isTestnet: true,
  nativeToken: arbitrumNetworkInformation.nativeToken,
  tokenBridge: {
    parentGatewayRouter: tokenBridgeContracts.parentChainContracts.router,
    parentErc20Gateway: tokenBridgeContracts.parentChainContracts.standardGateway,
    parentCustomGateway: tokenBridgeContracts.parentChainContracts.customGateway,
    parentWethGateway: tokenBridgeContracts.parentChainContracts.wethGateway,
    parentWeth: tokenBridgeContracts.parentChainContracts.weth,
    parentMultiCall: tokenBridgeContracts.parentChainContracts.multicall,
    childGatewayRouter: tokenBridgeContracts.orbitChainContracts.router,
    childErc20Gateway: tokenBridgeContracts.orbitChainContracts.standardGateway,
    childCustomGateway: tokenBridgeContracts.orbitChainContracts.customGateway,
    childWethGateway: tokenBridgeContracts.orbitChainContracts.wethGateway,
    childWeth: tokenBridgeContracts.orbitChainContracts.weth,
    childMultiCall: tokenBridgeContracts.orbitChainContracts.multicall,
  },
};
registerCustomArbitrumNetwork(arbitrumNetwork);

if (arbitrumNetwork.nativeToken?.toLowerCase() !== deploymentConfig.l1CrynuxTokenAddress.toLowerCase()) {
  throw new Error(
    `Expected the Orbit native token to be ${deploymentConfig.l1CrynuxTokenAddress}, but got ${arbitrumNetwork.nativeToken ?? 'ETH'}.`,
  );
}

const ethBridger = await EthBridger.fromProvider(orbitChainProvider);
const l2BalanceBefore = await orbitChainPublicClient.getBalance({
  address: rollupDeployer.address,
});
const currentAllowance = await fetchAllowance({
  address: deploymentConfig.l1CrynuxTokenAddress,
  owner: rollupDeployer.address,
  spender: coreContracts.inbox,
  publicClient: parentChainPublicClient,
});

console.log('Crynux token L1 to L2 deposit state:');
console.log(
  JSON.stringify(
    {
      account: rollupDeployer.address,
      token: deploymentConfig.l1CrynuxTokenAddress,
      inbox: coreContracts.inbox,
      amount: formatUnits(depositAmount, 18),
      l1BalanceBefore: formatUnits(l1BalanceBefore, 18),
      l2NativeBalanceBefore: formatUnits(l2BalanceBefore, 18),
      currentAllowance: formatUnits(currentAllowance, 18),
    },
    null,
    2,
  ),
);

if (currentAllowance < depositAmount) {
  const approveTransaction = await ethBridger.approveGasToken({
    parentSigner: parentChainSigner,
    amount: BigNumber.from(depositAmount.toString()),
  });
  const approveTransactionReceipt = await approveTransaction.wait();

  console.log('Crynux token approve transaction receipt:');
  console.log(
    JSON.stringify(
      {
        transactionHash: approveTransactionReceipt.transactionHash,
        status: approveTransactionReceipt.status,
        blockNumber: approveTransactionReceipt.blockNumber,
      },
      null,
      2,
    ),
  );
} else {
  console.log('Allowance is already sufficient. Skipping approve transaction.');
}

const depositTransaction = await ethBridger.deposit({
  parentSigner: parentChainSigner,
  amount: BigNumber.from(depositAmount.toString()),
});
const depositTransactionReceipt = await depositTransaction.wait();

console.log('Crynux token deposit transaction receipt:');
console.log(
  JSON.stringify(
    {
      transactionHash: depositTransactionReceipt.transactionHash,
      status: depositTransactionReceipt.status,
      blockNumber: depositTransactionReceipt.blockNumber,
    },
    null,
    2,
  ),
);

const childTransactionReceipt = await depositTransactionReceipt.waitForChildTransactionReceipt(orbitChainProvider);

if (!childTransactionReceipt.complete) {
  throw new Error('L2 deposit did not complete.');
}

const expectedL2Balance = l2BalanceBefore + depositAmount;
const maxAttempts = 120;
const pollIntervalMs = 5000;

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const l2BalanceAfter = await orbitChainPublicClient.getBalance({
    address: rollupDeployer.address,
  });

  if (l2BalanceAfter >= expectedL2Balance) {
    console.log('Crynux token deposit confirmed on L2:');
    console.log(
      JSON.stringify(
        {
          account: rollupDeployer.address,
          amount: formatUnits(depositAmount, 18),
          l2NativeBalanceBefore: formatUnits(l2BalanceBefore, 18),
          l2NativeBalanceAfter: formatUnits(l2BalanceAfter, 18),
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  console.log(`Waiting for L2 balance update (${attempt}/${maxAttempts})...`);
  await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
}

throw new Error('Timed out while waiting for the L2 native balance to reflect the Crynux token deposit.');
