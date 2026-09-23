import { expect } from "chai";
import hre from "hardhat";

async function getEthers() {
    const connection = await hre.network.getOrCreate();
    return connection.ethers;
}

async function deployContracts() {
    const ethers = await getEthers();
    const [
        deployer,
        unauthorized,
        relayAdmin,
        slashReceiver,
        nodeOperator,
        delegator,
        secondDelegator,
        governor,
    ] = await ethers.getSigners();

    const benefitAddress = await ethers.deployContract("BenefitAddress");
    const nodeStaking = await ethers.deployContract("NodeStaking", [
        await benefitAddress.getAddress(),
        slashReceiver.address,
        1n,
    ]);
    const delegatedStaking = await ethers.deployContract("DelegatedStaking", [
        slashReceiver.address,
        1n,
    ]);
    const observer = await ethers.deployContract("MockStakeObserver");

    await nodeStaking.setAdminAddress(relayAdmin.address);
    await nodeStaking.setForceUnstakeDelay(1);
    await delegatedStaking.setAdminAddress(relayAdmin.address);

    return {
        ethers,
        deployer,
        unauthorized,
        relayAdmin,
        slashReceiver,
        nodeOperator,
        delegator,
        secondDelegator,
        governor,
        benefitAddress,
        nodeStaking,
        delegatedStaking,
        observer,
    };
}

describe("staking owner controls", () => {
    it("allows only the owner to update validated parameters and emits old and new values", async () => {
        const {
            unauthorized,
            relayAdmin,
            nodeStaking,
            delegatedStaking,
            observer,
        } = await deployContracts();

        await expect(
            nodeStaking.connect(unauthorized).setMinStakeAmount(2)
        )
            .to.be.revertedWithCustomError(
                nodeStaking,
                "OwnableUnauthorizedAccount"
            )
            .withArgs(unauthorized.address);
        await expect(
            nodeStaking
                .connect(unauthorized)
                .setAdminAddress(unauthorized.address)
        ).to.be.revertedWithCustomError(
            nodeStaking,
            "OwnableUnauthorizedAccount"
        );
        await expect(
            delegatedStaking
                .connect(unauthorized)
                .setObserver(await observer.getAddress())
        ).to.be.revertedWithCustomError(
            delegatedStaking,
            "OwnableUnauthorizedAccount"
        );
        await expect(nodeStaking.setAdminAddress(relayAdmin.address))
            .to.emit(nodeStaking, "AdminAddressUpdated")
            .withArgs(relayAdmin.address, relayAdmin.address);
        await expect(nodeStaking.setMinStakeAmount(2))
            .to.emit(nodeStaking, "MinStakeAmountUpdated")
            .withArgs(1, 2);
        await expect(nodeStaking.setForceUnstakeDelay(2))
            .to.emit(nodeStaking, "ForceUnstakeDelayUpdated")
            .withArgs(1, 2);
        await expect(nodeStaking.setObserver(await observer.getAddress()))
            .to.emit(nodeStaking, "ObserverUpdated")
            .withArgs(
                (await getEthers()).ZeroAddress,
                await observer.getAddress()
            );
        await expect(delegatedStaking.setMinStakeAmount(2))
            .to.emit(delegatedStaking, "MinStakeAmountUpdated")
            .withArgs(1, 2);

        await expect(
            nodeStaking.setAdminAddress((await getEthers()).ZeroAddress)
        ).to.be.revertedWith("admin address is zero");
        await expect(
            delegatedStaking.setAdminAddress((await getEthers()).ZeroAddress)
        ).to.be.revertedWith("admin address is zero");
        await expect(
            nodeStaking.setObserver(unauthorized.address)
        ).to.be.revertedWith("observer is not a contract");
        await expect(
            delegatedStaking.setObserver(unauthorized.address)
        ).to.be.revertedWith("observer is not a contract");
        await expect(nodeStaking.setMinStakeAmount(0)).to.be.revertedWith(
            "minimum stake amount is 0"
        );
        await expect(
            delegatedStaking.setMinStakeAmount(0)
        ).to.be.revertedWith("minimum stake amount is 0");
        await expect(nodeStaking.setForceUnstakeDelay(0)).to.be.revertedWith(
            "force unstake delay is 0"
        );
    });

    it("hands parameter authority to the new owner", async () => {
        const { deployer, governor, nodeStaking, delegatedStaking } =
            await deployContracts();

        await nodeStaking.transferOwnership(governor.address);
        await delegatedStaking.transferOwnership(governor.address);

        await expect(
            nodeStaking.connect(deployer).setMinStakeAmount(2)
        ).to.be.revertedWithCustomError(
            nodeStaking,
            "OwnableUnauthorizedAccount"
        );
        await nodeStaking.connect(governor).setMinStakeAmount(2);
        await delegatedStaking.connect(governor).setMinStakeAmount(2);

        expect(await nodeStaking.getMinStakeAmount()).to.equal(2);
        expect(await delegatedStaking.getMinStakeAmount()).to.equal(2);
    });

    it("does not allow either staking owner to renounce ownership", async () => {
        const { deployer, nodeStaking, delegatedStaking } =
            await deployContracts();

        await expect(
            nodeStaking.renounceOwnership()
        ).to.be.revertedWithCustomError(
            nodeStaking,
            "OwnershipRenouncementDisabled"
        );
        await expect(
            delegatedStaking.renounceOwnership()
        ).to.be.revertedWithCustomError(
            delegatedStaking,
            "OwnershipRenouncementDisabled"
        );

        expect(await nodeStaking.owner()).to.equal(deployer.address);
        expect(await delegatedStaking.owner()).to.equal(deployer.address);
    });

    it("keeps fund-routing bindings fixed at constructor values", async () => {
        const {
            slashReceiver,
            benefitAddress,
            nodeStaking,
            delegatedStaking,
        } = await deployContracts();

        expect(await nodeStaking.ba()).to.equal(
            await benefitAddress.getAddress()
        );
        expect(await nodeStaking.slashReceiver()).to.equal(
            slashReceiver.address
        );
        expect(await delegatedStaking.slashReceiver()).to.equal(
            slashReceiver.address
        );
    });
});

describe("staking observer availability", () => {
    it("pauses amount changes while observers are zero and resumes after configuration", async () => {
        const {
            ethers,
            nodeOperator,
            delegator,
            nodeStaking,
            delegatedStaking,
            observer,
        } = await deployContracts();

        await delegatedStaking.connect(nodeOperator).setDelegatorShare(10);
        await expect(
            nodeStaking.connect(nodeOperator).stake(3, { value: 3 })
        ).to.be.revertedWith("observer not configured");
        await expect(
            delegatedStaking
                .connect(delegator)
                .stake(nodeOperator.address, 3, { value: 3 })
        ).to.be.revertedWith("observer not configured");

        await nodeStaking.setObserver(await observer.getAddress());
        await delegatedStaking.setObserver(await observer.getAddress());
        await observer.configureStateCheck(true, false, 3);
        await nodeStaking.connect(nodeOperator).stake(3, { value: 3 });
        await observer.configureStateCheck(false, true, 3);
        await delegatedStaking
            .connect(delegator)
            .stake(nodeOperator.address, 3, { value: 3 });

        await nodeStaking.setObserver(ethers.ZeroAddress);
        await delegatedStaking.setObserver(ethers.ZeroAddress);

        await nodeStaking.connect(nodeOperator).stake(3);
        await delegatedStaking.connect(delegator).stake(nodeOperator.address, 3);
        await expect(
            nodeStaking.connect(nodeOperator).stake(2)
        ).to.be.revertedWith("observer not configured");
        await expect(
            delegatedStaking.connect(delegator).stake(nodeOperator.address, 2)
        ).to.be.revertedWith("observer not configured");
        await expect(
            delegatedStaking.connect(delegator).unstake(nodeOperator.address)
        ).to.be.revertedWith("observer not configured");

        expect(
            (await nodeStaking.getStakingInfo(nodeOperator.address))
                .stakedBalance
        ).to.equal(3);
        expect(
            await delegatedStaking.getDelegatorTotalStakeAmount(
                delegator.address
            )
        ).to.equal(3);

        await expect(
            nodeStaking.connect(nodeOperator).tryUnstake()
        ).to.be.revertedWith("observer not configured");
        expect(
            (await nodeStaking.getStakingInfo(nodeOperator.address)).status
        ).to.equal(1);

        await nodeStaking.setObserver(await observer.getAddress());
        await delegatedStaking.setObserver(await observer.getAddress());
        await nodeStaking.connect(nodeOperator).tryUnstake();
        await observer.configureStateCheck(true, false, 0);
        await ethers.provider.send("evm_increaseTime", [2]);
        await ethers.provider.send("evm_mine", []);
        await nodeStaking.connect(nodeOperator).forceUnstake();
        await observer.configureStateCheck(false, true, 2);
        await delegatedStaking.connect(delegator).stake(nodeOperator.address, 2);

        expect(
            await delegatedStaking.getDelegatorTotalStakeAmount(
                delegator.address
            )
        ).to.equal(2);
    });
});

describe("NodeStaking observer", () => {
    it("requires an observer for native stake changes and exposes final state", async () => {
        const { nodeOperator, nodeStaking, observer } = await deployContracts();

        await expect(
            nodeStaking.connect(nodeOperator).stake(2, { value: 2 })
        ).to.be.revertedWith("observer not configured");

        await nodeStaking.setObserver(await observer.getAddress());
        await observer.configureStateCheck(true, false, 2);
        await nodeStaking.connect(nodeOperator).stake(2, { value: 2 });
        expect(await observer.getCallCount()).to.equal(1);
        expect(await observer.getCall(0)).to.deep.equal([
            await nodeStaking.getAddress(),
            nodeOperator.address,
        ]);

        await observer.configureStateCheck(true, false, 5);
        await nodeStaking.connect(nodeOperator).stake(5, { value: 3 });
        expect(await observer.getCallCount()).to.equal(2);
        expect(await observer.getCall(1)).to.deep.equal([
            await nodeStaking.getAddress(),
            nodeOperator.address,
        ]);

        await nodeStaking.connect(nodeOperator).stake(5);
        expect(await observer.getCallCount()).to.equal(2);

        await observer.configureStateCheck(true, false, 3);
        await nodeStaking.connect(nodeOperator).stake(3);
        expect(await observer.getCallCount()).to.equal(3);
        expect(
            (await nodeStaking.getStakingInfo(nodeOperator.address))
                .stakedBalance
        ).to.equal(3);
    });

    it("notifies force unstake, Relay unstake, and slash before transferring funds", async () => {
        const {
            ethers,
            relayAdmin,
            slashReceiver,
            nodeOperator,
            nodeStaking,
            observer,
        } = await deployContracts();

        await nodeStaking.setObserver(await observer.getAddress());
        await nodeStaking.connect(nodeOperator).stake(3, { value: 3 });
        await nodeStaking.connect(nodeOperator).tryUnstake();
        expect(await observer.getCallCount()).to.equal(1);
        await observer.configureStateCheck(true, false, 0);
        await ethers.provider.send("evm_increaseTime", [2]);
        await ethers.provider.send("evm_mine", []);
        await nodeStaking.connect(nodeOperator).forceUnstake();
        expect(await observer.getCallCount()).to.equal(2);

        await observer.configureStateCheck(true, false, 2);
        await nodeStaking.connect(nodeOperator).stake(2, { value: 2 });
        await observer.configureStateCheck(true, false, 0);
        await nodeStaking.connect(relayAdmin).unstake(nodeOperator.address);
        expect(await observer.getCallCount()).to.equal(4);

        await observer.configureStateCheck(true, false, 4);
        await nodeStaking.connect(nodeOperator).stake(4, { value: 4 });
        await observer.configureStateCheck(true, false, 0);
        const receiverBalanceBefore = await ethers.provider.getBalance(
            slashReceiver.address
        );
        await nodeStaking
            .connect(relayAdmin)
            .slashStaking(nodeOperator.address);
        const receiverBalanceAfter = await ethers.provider.getBalance(
            slashReceiver.address
        );
        expect(receiverBalanceAfter - receiverBalanceBefore).to.equal(4);
        expect(await observer.getCallCount()).to.equal(6);
    });

    it("rolls back state when the observer reverts", async () => {
        const { nodeOperator, nodeStaking, observer } = await deployContracts();

        await nodeStaking.setObserver(await observer.getAddress());
        await observer.setShouldRevert(true);
        await expect(
            nodeStaking.connect(nodeOperator).stake(3, { value: 3 })
        ).to.be.revertedWith("observer reverted");

        expect(
            (await nodeStaking.getStakingInfo(nodeOperator.address))
                .stakedBalance
        ).to.equal(0);
        expect(await getEthers().then((e) => e.provider.getBalance(nodeStaking))).to.equal(0);
    });

    it("blocks observer reentry without corrupting stake accounting", async () => {
        const { nodeOperator, nodeStaking, observer } = await deployContracts();
        const reentryCall = nodeStaking.interface.encodeFunctionData("stake", [
            1,
        ]);

        await observer.setReentryCall(reentryCall);
        await nodeStaking.setObserver(await observer.getAddress());
        await nodeStaking.connect(nodeOperator).stake(3, { value: 3 });

        expect(await observer.reentrySucceeded()).to.equal(false);
        expect(
            (await nodeStaking.getStakingInfo(nodeOperator.address))
                .stakedBalance
        ).to.equal(3);
        expect(await observer.getCallCount()).to.equal(1);
    });
});

describe("DelegatedStaking observer", () => {
    it("notifies for amount changes and unstake but not share or unchanged amount", async () => {
        const {
            nodeOperator,
            delegator,
            delegatedStaking,
            observer,
        } = await deployContracts();

        await delegatedStaking.setObserver(await observer.getAddress());
        await delegatedStaking.connect(nodeOperator).setDelegatorShare(10);
        expect(await observer.getCallCount()).to.equal(0);

        await observer.configureStateCheck(false, true, 5);
        await delegatedStaking
            .connect(delegator)
            .stake(nodeOperator.address, 5, { value: 5 });
        await delegatedStaking.connect(delegator).stake(nodeOperator.address, 5);
        expect(await observer.getCallCount()).to.equal(1);

        await observer.configureStateCheck(false, true, 3);
        await delegatedStaking
            .connect(delegator)
            .stake(nodeOperator.address, 3);
        await observer.configureStateCheck(false, true, 0);
        await delegatedStaking.connect(delegator).unstake(nodeOperator.address);
        expect(await observer.getCallCount()).to.equal(3);
    });

    it("notifies every slashed delegator and transfers the complete batch", async () => {
        const {
            ethers,
            relayAdmin,
            slashReceiver,
            nodeOperator,
            delegator,
            secondDelegator,
            delegatedStaking,
            observer,
        } = await deployContracts();

        await delegatedStaking.connect(nodeOperator).setDelegatorShare(10);
        await delegatedStaking.setObserver(await observer.getAddress());
        await delegatedStaking
            .connect(delegator)
            .stake(nodeOperator.address, 3, { value: 3 });
        await delegatedStaking
            .connect(secondDelegator)
            .stake(nodeOperator.address, 4, { value: 4 });
        await observer.configureStateCheck(false, true, 0);

        const receiverBalanceBefore = await ethers.provider.getBalance(
            slashReceiver.address
        );
        await delegatedStaking
            .connect(relayAdmin)
            .slashNodeDelegations(nodeOperator.address, [
                delegator.address,
                secondDelegator.address,
            ]);
        const receiverBalanceAfter = await ethers.provider.getBalance(
            slashReceiver.address
        );

        expect(receiverBalanceAfter - receiverBalanceBefore).to.equal(7);
        expect(await observer.getCallCount()).to.equal(4);
        expect((await observer.getCall(2))[1]).to.equal(delegator.address);
        expect((await observer.getCall(3))[1]).to.equal(
            secondDelegator.address
        );
    });

    it("rolls back an entire slash batch when the observer reverts", async () => {
        const {
            relayAdmin,
            nodeOperator,
            delegator,
            secondDelegator,
            delegatedStaking,
            observer,
        } = await deployContracts();

        await delegatedStaking.connect(nodeOperator).setDelegatorShare(10);
        await delegatedStaking.setObserver(await observer.getAddress());
        await delegatedStaking
            .connect(delegator)
            .stake(nodeOperator.address, 3, { value: 3 });
        await delegatedStaking
            .connect(secondDelegator)
            .stake(nodeOperator.address, 4, { value: 4 });
        await observer.setShouldRevert(true);

        await expect(
            delegatedStaking
                .connect(relayAdmin)
                .slashNodeDelegations(nodeOperator.address, [
                    delegator.address,
                    secondDelegator.address,
                ])
        ).to.be.revertedWith("observer reverted");
        expect(
            await delegatedStaking.getDelegatorTotalStakeAmount(
                delegator.address
            )
        ).to.equal(3);
        expect(
            await delegatedStaking.getDelegatorTotalStakeAmount(
                secondDelegator.address
            )
        ).to.equal(4);
        expect(
            await delegatedStaking.getNodeTotalStakeAmount(
                nodeOperator.address
            )
        ).to.equal(7);
    });

    it("blocks observer reentry without changing delegated accounting twice", async () => {
        const {
            nodeOperator,
            delegator,
            delegatedStaking,
            observer,
        } = await deployContracts();
        const reentryCall = delegatedStaking.interface.encodeFunctionData(
            "unstake",
            [nodeOperator.address]
        );

        await delegatedStaking.connect(nodeOperator).setDelegatorShare(10);
        await observer.setReentryCall(reentryCall);
        await delegatedStaking.setObserver(await observer.getAddress());
        await delegatedStaking
            .connect(delegator)
            .stake(nodeOperator.address, 3, { value: 3 });

        expect(await observer.reentrySucceeded()).to.equal(false);
        expect(
            await delegatedStaking.getDelegatorTotalStakeAmount(
                delegator.address
            )
        ).to.equal(3);
        expect(await observer.getCallCount()).to.equal(1);
    });
});
