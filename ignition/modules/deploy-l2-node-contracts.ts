import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("DeployNodeContracts", (m) => {
    const relayAdminAddress = m.getParameter("relayAdminAddress");
    const creditsAdminAddress = m.getParameter("creditsAdminAddress");

    const credits = m.contract("Credits");
    const benefitAddress = m.contract("BenefitAddress");
    const delegatedStaking = m.contract("DelegatedStaking");
    const nodeStaking = m.contract("NodeStaking", [
        credits,
        benefitAddress,
        delegatedStaking,
    ]);

    m.call(credits, "setStakingAddress", [nodeStaking], {
        id: "SetCreditsStakingAddress",
    });
    m.call(credits, "setAdminAddress", [creditsAdminAddress], {
        id: "SetCreditsAdminAddress",
    });
    m.call(delegatedStaking, "setNodeStakingAddress", [nodeStaking], {
        id: "SetDelegatedStakingNodeStakingAddress",
    });
    m.call(nodeStaking, "setAdminAddress", [relayAdminAddress], {
        id: "SetNodeStakingAdminAddress",
    });

    return {
        credits,
        benefitAddress,
        delegatedStaking,
        nodeStaking,
    };
});
