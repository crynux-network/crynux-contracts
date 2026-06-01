import {
  createTokenBridgeFetchTokenBridgeContracts,
  createTokenBridgePrepareCustomFeeTokenApprovalTransactionRequest,
  createTokenBridgePrepareTransactionReceipt,
  createTokenBridgePrepareTransactionRequest,
  fetchAllowance,
  isTokenBridgeDeployed,
  utils,
} from '@arbitrum/chain-sdk';
import { formatUnits, parseUnits } from 'viem';
import {
  getBaseCrynuxTokenAddress,
  getCoreContracts,
  getDeployerAccount,
  orbitChainPublicClient,
  parentChainPublicClient,
} from './common.js';

const deployer = await getDeployerAccount();
const coreContracts = getCoreContracts();
const tokenBridgeCreator = utils.getTokenBridgeCreatorAddress(parentChainPublicClient);
const baseCrynuxTokenAddress = getBaseCrynuxTokenAddress();
const tokenBridgeRequiredAllowance = parseUnits('1', 18);

const isDeployed = await isTokenBridgeDeployed({
  parentChainPublicClient,
  orbitChainPublicClient,
  rollup: coreContracts.rollup,
});

if (!isDeployed) {
  const currentAllowance = await fetchAllowance({
    address: baseCrynuxTokenAddress,
    owner: deployer.address,
    spender: tokenBridgeCreator,
    publicClient: parentChainPublicClient,
  });

  console.log('Token bridge custom gas token approval state:');
  console.log(
    JSON.stringify(
      {
        owner: deployer.address,
        spender: tokenBridgeCreator,
        token: baseCrynuxTokenAddress,
        requiredAllowance: formatUnits(tokenBridgeRequiredAllowance, 18),
        currentAllowance: formatUnits(currentAllowance, 18),
      },
      null,
      2,
    ),
  );

  if (currentAllowance < tokenBridgeRequiredAllowance) {
    const approvalTransactionRequest = await createTokenBridgePrepareCustomFeeTokenApprovalTransactionRequest({
      amount: tokenBridgeRequiredAllowance,
      nativeToken: baseCrynuxTokenAddress,
      owner: deployer.address,
      publicClient: parentChainPublicClient,
    });
    const approvalTransactionHash = await parentChainPublicClient.sendRawTransaction({
      serializedTransaction: await deployer.signTransaction(approvalTransactionRequest),
    });
    const approvalTransactionReceipt = await parentChainPublicClient.waitForTransactionReceipt({
      hash: approvalTransactionHash,
    });

    console.log('Token bridge custom gas token approve transaction receipt:');
    console.log(
      JSON.stringify(approvalTransactionReceipt, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2),
    );
  }

  const createTokenBridgeTransactionRequest = await createTokenBridgePrepareTransactionRequest({
    params: {
      rollup: coreContracts.rollup,
      rollupOwner: deployer.address,
    },
    parentChainPublicClient,
    orbitChainPublicClient,
    account: deployer.address,
  });

  console.log('Deploying the TokenBridge...');
  const createTokenBridgeTransactionHash = await parentChainPublicClient.sendRawTransaction({
    serializedTransaction: await deployer.signTransaction(createTokenBridgeTransactionRequest),
  });
  const createTokenBridgeTransactionReceipt = createTokenBridgePrepareTransactionReceipt(
    await parentChainPublicClient.waitForTransactionReceipt({ hash: createTokenBridgeTransactionHash }),
  );

  console.log('Token bridge deployment transaction receipt:');
  console.log(
    JSON.stringify(createTokenBridgeTransactionReceipt, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2),
  );

  console.log('Waiting for retryable tickets to execute on the Orbit chain...');
  const retryableReceipts = await createTokenBridgeTransactionReceipt.waitForRetryables({
    orbitPublicClient: orbitChainPublicClient,
  });

  for (const [index, retryableReceipt] of retryableReceipts.entries()) {
    if (retryableReceipt.status !== 'success') {
      throw new Error(`Retryable ${index + 1} status is not success: ${retryableReceipt.status}.`);
    }
  }
} else {
  console.log('Token bridge contracts are already deployed.');
}

const tokenBridgeContracts = await createTokenBridgeFetchTokenBridgeContracts({
  inbox: coreContracts.inbox,
  parentChainPublicClient,
});

console.log('Token bridge contracts:');
console.log(JSON.stringify(tokenBridgeContracts, null, 2));
