import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("DeployNodeContracts", (m) => {
    const relayOperatorAddress = m.getParameter("relayOperatorAddress");
    const slashReceiverAddress = m.getParameter("slashReceiverAddress");
    const nodeMinStakeAmount = m.getParameter(
        "nodeMinStakeAmount",
        400n * 10n ** 18n
    );
    const delegatedMinStakeAmount = m.getParameter(
        "delegatedMinStakeAmount",
        400n * 10n ** 18n
    );
    const forceUnstakeDelay = m.getParameter("forceUnstakeDelay", 1800n);

    const benefitAddress = m.contract("BenefitAddress");
    const delegatedStaking = m.contract("DelegatedStaking", [
        slashReceiverAddress,
        delegatedMinStakeAmount,
    ]);
    const nodeStaking = m.contract("NodeStaking", [
        benefitAddress,
        slashReceiverAddress,
        nodeMinStakeAmount,
    ]);

    m.call(nodeStaking, "setAdminAddress", [relayOperatorAddress], {
        id: "SetNodeStakingAdminAddress",
    });
    m.call(delegatedStaking, "setAdminAddress", [relayOperatorAddress], {
        id: "SetDelegatedStakingAdminAddress",
    });
    m.call(nodeStaking, "setForceUnstakeDelay", [forceUnstakeDelay], {
        id: "SetNodeStakingForceUnstakeDelay",
    });

    return {
        benefitAddress,
        delegatedStaking,
        nodeStaking,
    };
});
