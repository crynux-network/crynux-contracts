import {
  createTokenBridgeDefaultRetryablesFees,
  createTokenBridgeFetchTokenBridgeContracts,
  createTokenBridgePrepareCustomFeeTokenApprovalTransactionRequest,
  createTokenBridgePrepareTransactionReceipt,
  createTokenBridgePrepareTransactionRequest,
  fetchAllowance,
  isTokenBridgeDeployed,
  utils,
} from '@arbitrum/chain-sdk';
import { formatUnits } from 'viem';
import {
  deploymentConfig,
  getCoreContracts,
  getRollupDeployerAccount,
  orbitChainPublicClient,
  parentChainPublicClient,
} from './common.js';

const rollupDeployer = await getRollupDeployerAccount();
const coreContracts = getCoreContracts();
const tokenBridgeCreator = utils.getTokenBridgeCreatorAddress(parentChainPublicClient);

const isDeployed = await isTokenBridgeDeployed({
  parentChainPublicClient,
  orbitChainPublicClient,
  rollup: coreContracts.rollup,
});

if (isDeployed) {
  const tokenBridgeContracts = await createTokenBridgeFetchTokenBridgeContracts({
    inbox: coreContracts.inbox,
    parentChainPublicClient,
  });

  console.log('Token bridge contracts are already deployed:');
  console.log(JSON.stringify(tokenBridgeContracts, null, 2));
} else {
  const currentAllowance = await fetchAllowance({
    address: deploymentConfig.l1CrynuxTokenAddress,
    owner: rollupDeployer.address,
    spender: tokenBridgeCreator,
    publicClient: parentChainPublicClient,
  });

  console.log('Token bridge custom gas token approval state:');
  console.log(
    JSON.stringify(
      {
        owner: rollupDeployer.address,
        spender: tokenBridgeCreator,
        token: deploymentConfig.l1CrynuxTokenAddress,
        requiredAllowance: formatUnits(createTokenBridgeDefaultRetryablesFees, 18),
        currentAllowance: formatUnits(currentAllowance, 18),
      },
      null,
      2,
    ),
  );

  if (currentAllowance < createTokenBridgeDefaultRetryablesFees) {
    const approvalTransactionRequest = await createTokenBridgePrepareCustomFeeTokenApprovalTransactionRequest({
      nativeToken: deploymentConfig.l1CrynuxTokenAddress,
      owner: rollupDeployer.address,
      publicClient: parentChainPublicClient,
    });
    const approvalTransactionHash = await parentChainPublicClient.sendRawTransaction({
      serializedTransaction: await rollupDeployer.signTransaction(approvalTransactionRequest),
    });
    const approvalTransactionReceipt = await parentChainPublicClient.waitForTransactionReceipt({
      hash: approvalTransactionHash,
    });

    console.log('Token bridge custom gas token approve transaction receipt:');
    console.log(
      JSON.stringify(approvalTransactionReceipt, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2),
    );
  } else {
    console.log('Allowance is already sufficient. Skipping approve transaction.');
  }

  const createTokenBridgeTransactionRequest = await createTokenBridgePrepareTransactionRequest({
    params: {
      rollup: coreContracts.rollup,
      rollupOwner: rollupDeployer.address,
    },
    parentChainPublicClient,
    orbitChainPublicClient,
    account: rollupDeployer.address,
  });

  console.log('Deploying the TokenBridge...');
  const createTokenBridgeTransactionHash = await parentChainPublicClient.sendRawTransaction({
    serializedTransaction: await rollupDeployer.signTransaction(createTokenBridgeTransactionRequest),
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

  const tokenBridgeContracts = await createTokenBridgeFetchTokenBridgeContracts({
    inbox: coreContracts.inbox,
    parentChainPublicClient,
  });

  console.log('Token bridge contracts:');
  console.log(JSON.stringify(tokenBridgeContracts, null, 2));
}
