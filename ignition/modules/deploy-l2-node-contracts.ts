import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("DeployNodeContracts", (m) => {
    const relayOperatorAddress = m.getParameter("relayOperatorAddress");
    const creditsAdminAddress = m.getParameter("creditsAdminAddress");
    const parameterWriterAddress = m.getParameter("parameterWriterAddress");
    const slashReceiverAddress = m.getParameter("slashReceiverAddress");

    const credits = m.contract("Credits");
    const benefitAddress = m.contract("BenefitAddress");
    const delegatedStaking = m.contract("DelegatedStaking", [
        slashReceiverAddress,
    ]);
    const nodeStaking = m.contract("NodeStaking", [
        credits,
        benefitAddress,
        delegatedStaking,
        slashReceiverAddress,
    ]);
    const parameterController = m.contract("ParameterController", [
        nodeStaking,
        delegatedStaking,
        credits,
        parameterWriterAddress,
    ]);

    m.call(credits, "setStakingAddress", [nodeStaking], {
        id: "SetCreditsStakingAddress",
    });
    m.call(delegatedStaking, "setNodeStakingAddress", [nodeStaking], {
        id: "SetDelegatedStakingNodeStakingAddress",
    });

    m.call(credits, "setParameterController", [parameterController], {
        id: "SetCreditsParameterController",
    });
    m.call(delegatedStaking, "setParameterController", [parameterController], {
        id: "SetDelegatedStakingParameterController",
    });
    m.call(nodeStaking, "setParameterController", [parameterController], {
        id: "SetNodeStakingParameterController",
    });

    m.call(parameterController, "setCreditsAdminAddress", [creditsAdminAddress], {
        id: "SetCreditsAdminAddress",
    });
    m.call(parameterController, "setNodeStakingAdminAddress", [relayOperatorAddress], {
        id: "SetNodeStakingAdminAddress",
    });
    return {
        credits,
        benefitAddress,
        delegatedStaking,
        nodeStaking,
        parameterController,
    };
});
