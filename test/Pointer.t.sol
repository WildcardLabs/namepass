// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {NamepassFactory} from "../contracts/NamepassFactory.sol";
import {NamepassL1Gateway} from "../contracts/NamepassL1Gateway.sol";
import {ENSV2RenewalHelper} from "../contracts/ENSV2RenewalHelper.sol";
import {RenewalHelperPointer} from "../contracts/RenewalHelperPointer.sol";
import {MockUSDC, Dummy} from "./mocks/Mocks.sol";

contract PointerTest is Test {
    TimelockController internal timelock;
    RenewalHelperPointer internal pointer;
    NamepassL1Gateway internal gateway;
    NamepassFactory internal factory;
    MockUSDC internal usdc;
    ENSV2RenewalHelper internal adapter;
    address internal dummy;

    function setUp() public {
        vm.chainId(11155111);
        factory = new NamepassFactory(address(this), 11155111);
        usdc = new MockUSDC();
        dummy = address(new Dummy());
        timelock = _timelock();
        pointer = new RenewalHelperPointer(address(factory), address(usdc), address(timelock));
        gateway = new NamepassL1Gateway(address(factory), address(usdc), dummy, dummy, address(pointer), address(0xD57));
        adapter = _adapter(address(gateway));
        factory.initialize(address(usdc), address(0), address(gateway));
    }

    function _timelock() private returns (TimelockController) {
        address[] memory actors = new address[](1);
        actors[0] = address(this);
        return new TimelockController(1 days, actors, actors, address(0));
    }

    function _adapter(address target) private returns (ENSV2RenewalHelper) {
        return new ENSV2RenewalHelper(target, address(factory), address(usdc), dummy, address(0), bytes32(0));
    }

    function _execute(TimelockController executor, bytes memory callData) private {
        executor.schedule(address(pointer), 0, callData, bytes32(0), bytes32(0), 1 days);
        vm.warp(block.timestamp + 1 days);
        executor.execute(address(pointer), 0, callData, bytes32(0), bytes32(0));
    }

    function test_requiresTimelockAndHonorsDelay() public {
        vm.expectRevert(RenewalHelperPointer.NotGovernance.selector);
        pointer.setHelper(address(adapter));
        bytes memory callData = abi.encodeCall(pointer.setHelper, (address(adapter)));
        timelock.schedule(address(pointer), 0, callData, bytes32(0), bytes32(0), 1 days);
        vm.expectRevert();
        timelock.execute(address(pointer), 0, callData, bytes32(0), bytes32(0));
        assertEq(pointer.currentHelper(), address(0));
        vm.warp(block.timestamp + 1 days);
        timelock.execute(address(pointer), 0, callData, bytes32(0), bytes32(0));
        assertEq(pointer.currentHelper(), address(adapter));
        assertEq(pointer.gateway(), address(gateway));
    }

    function test_cancelledActivationCannotExecute() public {
        bytes memory callData = abi.encodeCall(pointer.setHelper, (address(adapter)));
        timelock.schedule(address(pointer), 0, callData, bytes32(0), bytes32(0), 1 days);
        timelock.cancel(timelock.hashOperation(address(pointer), 0, callData, bytes32(0), bytes32(0)));
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert();
        timelock.execute(address(pointer), 0, callData, bytes32(0), bytes32(0));
    }

    function test_replacementAndRollbackKeepWalletAndDestination() public {
        address wallet = factory.predictWallet("vitalik");
        _execute(timelock, abi.encodeCall(pointer.setHelper, (address(adapter))));
        ENSV2RenewalHelper next = _adapter(address(gateway));
        _execute(timelock, abi.encodeCall(pointer.setHelper, (address(next))));
        assertEq(factory.predictWallet("vitalik"), wallet);
        assertEq(factory.l1Helper(), address(gateway));
        assertEq(pointer.currentHelper(), address(next));
        // Use a distinct salt because the original activation operation is already complete.
        bytes memory callData = abi.encodeCall(pointer.setHelper, (address(adapter)));
        timelock.schedule(address(pointer), 0, callData, bytes32(0), bytes32(uint256(1)), 1 days);
        vm.warp(block.timestamp + 1 days);
        timelock.execute(address(pointer), 0, callData, bytes32(0), bytes32(uint256(1)));
        assertEq(pointer.currentHelper(), address(adapter));
        assertEq(factory.predictWallet("vitalik"), wallet);
    }

    function test_gatewayCannotBeRebound() public {
        _execute(timelock, abi.encodeCall(pointer.setHelper, (address(adapter))));
        NamepassL1Gateway other =
            new NamepassL1Gateway(address(factory), address(usdc), dummy, dummy, address(pointer), address(0xD57));
        ENSV2RenewalHelper bad = _adapter(address(other));
        vm.prank(address(timelock));
        vm.expectRevert(RenewalHelperPointer.IncompatibleHelper.selector);
        pointer.setHelper(address(bad));
    }

    function test_rejectsWrongFactoryTokenAndMissingCode() public {
        ENSV2RenewalHelper wrongFactory =
            new ENSV2RenewalHelper(address(gateway), dummy, address(usdc), dummy, address(0), bytes32(0));
        ENSV2RenewalHelper wrongToken =
            new ENSV2RenewalHelper(address(gateway), address(factory), dummy, dummy, address(0), bytes32(0));
        vm.startPrank(address(timelock));
        vm.expectRevert(RenewalHelperPointer.IncompatibleHelper.selector);
        pointer.setHelper(address(wrongFactory));
        vm.expectRevert(RenewalHelperPointer.IncompatibleHelper.selector);
        pointer.setHelper(address(wrongToken));
        vm.expectRevert(RenewalHelperPointer.InvalidAddress.selector);
        pointer.setHelper(address(0));
        vm.expectRevert(RenewalHelperPointer.InvalidAddress.selector);
        pointer.setHelper(address(0xBAD));
        vm.stopPrank();
    }

    function test_executorHandoverRequiresBothTimelocks() public {
        TimelockController next = _timelock();
        _execute(timelock, abi.encodeCall(pointer.transferGovernance, (address(next))));
        assertEq(pointer.ensGovernanceExecutor(), address(timelock));
        vm.expectRevert(RenewalHelperPointer.NotPendingGovernance.selector);
        pointer.acceptGovernance();
        _execute(next, abi.encodeCall(pointer.acceptGovernance, ()));
        assertEq(pointer.ensGovernanceExecutor(), address(next));
        vm.prank(address(timelock));
        vm.expectRevert(RenewalHelperPointer.NotGovernance.selector);
        pointer.setHelper(address(adapter));
        _execute(next, abi.encodeCall(pointer.setHelper, (address(adapter))));
    }

    function test_inactivePointerLeavesWalletFundsInPlace() public {
        address wallet = factory.predictWallet("vitalik");
        usdc.mint(wallet, 8_110_000);
        vm.expectRevert(NamepassL1Gateway.NoActiveHelper.selector);
        factory.renew("vitalik");
        assertEq(usdc.balanceOf(wallet), 8_110_000);
        assertEq(usdc.balanceOf(address(gateway)), 0);
    }
}
