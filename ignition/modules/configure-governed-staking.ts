import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("ConfigureGovernedStaking", (m) => {
    const nodeStakingAddress = m.getParameter("nodeStakingAddress");
    const delegatedStakingAddress = m.getParameter("delegatedStakingAddress");
    const councilRegistryAddress = m.getParameter("councilRegistryAddress");
    const councilGovernorAddress = m.getParameter("councilGovernorAddress");

    const nodeStaking = m.contractAt("NodeStaking", nodeStakingAddress);
    const delegatedStaking = m.contractAt(
        "DelegatedStaking",
        delegatedStakingAddress
    );

    const setNodeObserver = m.call(
        nodeStaking,
        "setObserver",
        [councilRegistryAddress],
        { id: "SetNodeStakingObserver" }
    );
    const setDelegatedObserver = m.call(
        delegatedStaking,
        "setObserver",
        [councilRegistryAddress],
        { id: "SetDelegatedStakingObserver" }
    );

    m.call(nodeStaking, "transferOwnership", [councilGovernorAddress], {
        id: "TransferNodeStakingOwnership",
        after: [setNodeObserver],
    });
    m.call(delegatedStaking, "transferOwnership", [councilGovernorAddress], {
        id: "TransferDelegatedStakingOwnership",
        after: [setDelegatedObserver],
    });

    return { nodeStaking, delegatedStaking };
});
