import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("DeployEmissionErc20", (m) => {
    const tokenAddress = m.getParameter("tokenAddress");
    const mode = m.getParameter("mode");
    const daoTreasuryAddress = m.getParameter("daoTreasuryAddress");
    const relayWalletColdAddress = m.getParameter("relayWalletColdAddress");
    const startTimestamp = m.getParameter("startTimestamp");
    const initialEmissionIndex = m.getParameter("initialEmissionIndex");
    const initCostCNX = m.getParameter("initCostCNX");
    const fundingAmountWei = m.getParameter("fundingAmountWei");

    const emissionERC20 = m.contract("EmissionERC20", [
        tokenAddress,
        mode,
        daoTreasuryAddress,
        relayWalletColdAddress,
        startTimestamp,
        initialEmissionIndex,
        initCostCNX,
    ]);

    const token = m.contractAt("CrynuxToken", tokenAddress, {
        id: "ExistingCrynuxToken",
    });
    m.call(token, "transfer", [emissionERC20, fundingAmountWei], {
        id: "FundEmissionERC20",
    });

    return {
        emissionERC20,
    };
});
