// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NamepassFactory} from "../contracts/NamepassFactory.sol";
import {NamepassL1Gateway} from "../contracts/NamepassL1Gateway.sol";
import {RenewalHelperPointer} from "../contracts/RenewalHelperPointer.sol";
import {ENSV2RenewalHelper} from "../contracts/ENSV2RenewalHelper.sol";
import {IETHRenewer} from "../contracts/interfaces/IENSRenewal.sol";
import {Dummy} from "./mocks/Mocks.sol";

interface ILiveRegistrar {
    function commit(bytes32 commitment) external;
    function MIN_COMMITMENT_AGE() external view returns (uint64);
    function register(
        string calldata label,
        address owner,
        bytes32 secret,
        address subregistry,
        address resolver,
        uint64 duration,
        IERC20 token,
        bytes32 referrer
    ) external returns (uint256);
}

interface ILiveRegistry {
    function findExpiry(string calldata label) external view returns (uint64);
}

/// @notice Opt-in tests against real ENS code at a fixed Sepolia block. No transactions are broadcast.
contract SepoliaForkTest is Test {
    uint256 constant FORK_BLOCK = 11_730_389;
    address constant REGISTRAR = 0xAbe76F6C8DFcEd81AA5A2bB8034202A7136b94ca;
    address constant V1 = 0xd06e726e9bD8ac0f33A2a45F4Cc28fe10d656a36;
    address constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address constant REGISTRY = 0x657eA849311d3D5823348ddEd7C2AaAFb3EDE09E;
    address constant TRANSMITTER = 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275;
    address constant MESSENGER = 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA;
    NamepassFactory internal factory;
    NamepassL1Gateway internal gateway;
    ENSV2RenewalHelper internal helper;
    bool internal enabled;

    function setUp() public {
        string memory rpc = vm.envOr("NAMEPASS_FORK_RPC", string(""));
        enabled = bytes(rpc).length != 0;
        if (!enabled) return;
        vm.createSelectFork(rpc, FORK_BLOCK);
        // Execute deployed ENS Cancun opcodes without changing our pinned Shanghai compilation.
        vm.setEvmVersion("cancun");
        factory = new NamepassFactory(address(this), 11155111);
        address executor = address(new Dummy());
        RenewalHelperPointer pointer = new RenewalHelperPointer(address(factory), USDC, executor);
        gateway =
            new NamepassL1Gateway(address(factory), USDC, TRANSMITTER, MESSENGER, address(pointer), address(0xD57));
        helper =
            new ENSV2RenewalHelper(address(gateway), address(factory), USDC, REGISTRAR, V1, bytes32(uint256(0x1208)));
        vm.prank(executor);
        pointer.setHelper(address(helper));
        factory.initialize(USDC, address(0), address(gateway));
    }

    function _renewAndCheck(string memory label, address renewer) private {
        assertEq(helper.renewableBy(label), renewer);
        uint256 amount = 27_110_000;
        uint256 allowance = gateway.GAS_ALLOWANCE();
        (uint64 duration, uint256 charge) = helper.quote(label, amount - allowance);
        assertEq(IETHRenewer(renewer).getRenewPrice(label, duration, IERC20(USDC)), charge);
        uint64 expiryBefore = ILiveRegistry(REGISTRY).findExpiry(label);
        (uint64 reportedExpiry, address selected) = helper.nameState(label);
        assertEq(reportedExpiry, expiryBefore);
        assertEq(selected, renewer);
        address wallet = factory.predictWallet(label);
        deal(USDC, wallet, amount);
        uint256 executorBefore = IERC20(USDC).balanceOf(address(this));
        factory.renew(label);
        assertEq(ILiveRegistry(REGISTRY).findExpiry(label), expiryBefore + duration);
        assertEq(IERC20(USDC).balanceOf(wallet), 0);
        assertEq(IERC20(USDC).balanceOf(address(this)), executorBefore + allowance);
        assertEq(IERC20(USDC).balanceOf(address(helper)), 0);
        assertEq(IERC20(USDC).balanceOf(address(gateway)), amount - allowance - charge);
        assertEq(IERC20(USDC).allowance(address(gateway), address(helper)), 0);
        assertEq(IERC20(USDC).allowance(address(helper), renewer), 0);
    }

    function testFork_premigratedV1Renewal() public {
        if (!enabled) {
            vm.skip(true);
            return;
        }
        _renewAndCheck("vitalik", V1);
    }

    function testFork_nativeV2Renewal() public {
        if (!enabled) {
            vm.skip(true);
            return;
        }
        string memory label = "namepass-overhaul-fork-11730389";
        bytes32 secret = keccak256("fork only");
        address registrant = address(0xA11CE);
        uint64 duration = 365 days;
        ILiveRegistrar registrar = ILiveRegistrar(REGISTRAR);
        registrar.commit(keccak256(abi.encode(label, registrant, secret, address(0), address(0), duration, bytes32(0))));
        vm.warp(block.timestamp + registrar.MIN_COMMITMENT_AGE() + 1);
        deal(USDC, address(this), 100_000_000);
        IERC20(USDC).approve(REGISTRAR, 100_000_000);
        registrar.register(label, registrant, secret, address(0), address(0), duration, IERC20(USDC), bytes32(0));
        _renewAndCheck(label, REGISTRAR);
    }
}
