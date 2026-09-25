import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("DeployNoOpStakeObserver", (m) => {
    const noopStakeObserver = m.contract("NoOpStakeObserver");

    return {
        noopStakeObserver,
    };
});
