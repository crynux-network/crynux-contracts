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
    const setCreditsParameterController = m.call(credits, "setParameterController", [parameterController], {
        id: "SetCreditsParameterController",
    });
    const setDelegatedStakingParameterController = m.call(delegatedStaking, "setParameterController", [parameterController], {
        id: "SetDelegatedStakingParameterController",
    });
    const setNodeStakingParameterController = m.call(nodeStaking, "setParameterController", [parameterController], {
        id: "SetNodeStakingParameterController",
    });
    const parameterControllerSetups = [
        setCreditsParameterController,
        setDelegatedStakingParameterController,
        setNodeStakingParameterController,
    ];

    m.call(parameterController, "setCreditsAdminAddress", [creditsAdminAddress], {
        id: "SetCreditsAdminAddress",
        after: parameterControllerSetups,
    });
    m.call(parameterController, "setNodeStakingAdminAddress", [relayOperatorAddress], {
        id: "SetNodeStakingAdminAddress",
        after: parameterControllerSetups,
    });
    m.call(parameterController, "setDelegatedStakingAdminAddress", [relayOperatorAddress], {
        id: "SetDelegatedStakingAdminAddress",
        after: parameterControllerSetups,
    });
    return {
        credits,
        benefitAddress,
        delegatedStaking,
        nodeStaking,
        parameterController,
    };
});
