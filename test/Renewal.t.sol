// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ENSV2RenewalHelper} from "../contracts/ENSV2RenewalHelper.sol";

import {
    StandardRentPriceOracle,
    DiscountPoint,
    PaymentRatio
} from "./ens/registrar/StandardRentPriceOracle.sol";
import {IRentPriceOracle} from "./ens/registrar/interfaces/IRentPriceOracle.sol";

import {MockUSDC, MockRenewer, MockFactory, MockMessageTransmitter, Dummy} from "./mocks/Mocks.sol";

/**
 * @notice The renewal path: allowance accounting, renewer selection,
 * and the assertions that make a mis-buy impossible.
 */
contract RenewalTest is Test {
    ENSV2RenewalHelper internal helper;
    StandardRentPriceOracle internal oracle;
    MockRenewer internal ethRegistrar;
    MockRenewer internal ethRenewerV1;
    MockUSDC internal usdc;
    MockFactory internal factory;

    address constant GOVERNANCE = address(0xE45);
    address constant REFERRER = address(0x1208);
    address constant EXECUTOR = address(0xEE);
    address constant WALLET = address(0xA11E7);

    string constant LABEL = "vitalik";

    function setUp() public {
        usdc = new MockUSDC();
        oracle = _deployOracle();

        ethRegistrar = new MockRenewer(IRentPriceOracle(address(oracle)), address(0xB1));
        ethRenewerV1 = new MockRenewer(IRentPriceOracle(address(oracle)), address(0xB2));

        /* Disjoint by construction, as ENS's predicates are. */
        ethRegistrar.setRenewable(true);
        ethRenewerV1.setRenewable(false);

        factory = new MockFactory();
        factory.setWallet(LABEL, WALLET);

        helper = new ENSV2RenewalHelper(
            address(factory),
            address(usdc),
            address(new MockMessageTransmitter(usdc)),
            address(new Dummy()),
            address(ethRegistrar),
            address(ethRenewerV1),
            GOVERNANCE,
            REFERRER
        );
    }

    function _deployOracle() internal returns (StandardRentPriceOracle) {
        uint256[] memory rates = new uint256[](5);
        rates[2] = 20_294_267;
        rates[3] = 5_073_567;
        rates[4] = 253_679;

        DiscountPoint[] memory points = new DiscountPoint[](3);
        points[0] = DiscountPoint({duration: 63_072_000, numer: 875e35});
        points[1] = DiscountPoint({duration: 94_608_000, numer: 6875e34});
        points[2] = DiscountPoint({duration: 189_216_000, numer: 5625e34});

        PaymentRatio[] memory ratios = new PaymentRatio[](1);
        ratios[0] = PaymentRatio({paymentToken: IERC20(address(usdc)), numer: 1, denom: 1e6});

        return new StandardRentPriceOracle(
            address(this), rates, points, 1e38, 0, 1, 1, ratios
        );
    }

    /// @dev Fund the wallet and approve the helper, as the factory does.
    function _fundWallet(uint256 amount) internal {
        usdc.mint(WALLET, amount);

        vm.prank(WALLET);
        usdc.approve(address(helper), amount);
    }

    /*//////////////////////////////////////////////////////////////
                           THE GAS ALLOWANCE
    //////////////////////////////////////////////////////////////*/

    function test_executorIsPaidTheAllowance() public {
        _fundWallet(27_110_000);

        vm.prank(WALLET);
        helper.renewFromWallet(LABEL, 27_110_000, EXECUTOR);

        assertEq(
            usdc.balanceOf(EXECUTOR),
            helper.GAS_ALLOWANCE(),
            "executor was not paid the allowance"
        );
    }

    /**
     * @dev The allowance comes off *before* pricing.
     *
     * `Simulator.tsx` solves durations from `budget - allowance`, so
     * if this ever stopped being true the UI would quote a duration
     * the chain does not deliver.
     */
    function test_allowanceIsDeductedBeforePricing() public {
        uint256 sent = 27_110_000;
        _fundWallet(sent);

        (uint64 expected,) = helper.quote(LABEL, sent - helper.GAS_ALLOWANCE());

        vm.prank(WALLET);
        helper.renewFromWallet(LABEL, sent, EXECUTOR);

        assertEq(
            ethRegistrar.lastDuration(),
            expected,
            "duration was not solved from the post-allowance amount"
        );
    }

    function test_rejectsPaymentAtOrBelowTheAllowance() public {
        /*
         * Read into a local first: an external call in the argument
         * list would consume the prank before `renewFromWallet` sees
         * it.
         */
        uint256 allowance = helper.GAS_ALLOWANCE();
        _fundWallet(allowance);

        vm.prank(WALLET);
        vm.expectRevert(ENSV2RenewalHelper.InsufficientAmount.selector);
        helper.renewFromWallet(LABEL, allowance, EXECUTOR);
    }

    /*//////////////////////////////////////////////////////////////
                              ACCOUNTING
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Everything sent is accounted for: charged + allowance +
     * remainder, with nothing unexplained left behind.
     */
    function testFuzz_everySentUnitIsAccountedFor(uint256 rawAmount) public {
        uint256 sent = bound(rawAmount, helper.GAS_ALLOWANCE() + 1_000, 1e12);
        _fundWallet(sent);

        vm.prank(WALLET);
        helper.renewFromWallet(LABEL, sent, EXECUTOR);

        uint256 charged = usdc.balanceOf(ethRegistrar.beneficiary());
        uint256 paidExecutor = usdc.balanceOf(EXECUTOR);
        uint256 dust = usdc.balanceOf(address(helper));

        assertEq(charged + paidExecutor + dust, sent, "funds went missing");
        assertEq(paidExecutor, helper.GAS_ALLOWANCE(), "wrong allowance paid");
        assertEq(usdc.balanceOf(WALLET), 0, "wallet was not fully drained");
    }

    /// @dev The remainder is sub-second rounding, not a meaningful sum.
    function test_remainderIsRoundingDustOnly() public {
        _fundWallet(27_110_000);

        vm.prank(WALLET);
        helper.renewFromWallet(LABEL, 27_110_000, EXECUTOR);

        assertLt(usdc.balanceOf(address(helper)), 10, "remainder is larger than rounding");
    }

    /// @dev Nothing may be left approved to a renewer after settlement.
    function test_noStandingAllowanceIsLeft() public {
        _fundWallet(27_110_000);

        vm.prank(WALLET);
        helper.renewFromWallet(LABEL, 27_110_000, EXECUTOR);

        assertEq(
            usdc.allowance(address(helper), address(ethRegistrar)),
            0,
            "a standing allowance survived the renewal"
        );
    }

    function test_referrerIsPassedThrough() public {
        _fundWallet(27_110_000);

        vm.prank(WALLET);
        helper.renewFromWallet(LABEL, 27_110_000, EXECUTOR);

        assertEq(ethRegistrar.lastReferrer(), helper.referrer(), "referrer was not forwarded");
    }

    /*//////////////////////////////////////////////////////////////
                          RENEWER SELECTION
    //////////////////////////////////////////////////////////////*/

    /// @dev A migrated name goes to `ETHRegistrar`.
    function test_selectsEthRegistrarForMigratedNames() public {
        _fundWallet(27_110_000);

        vm.prank(WALLET);
        helper.renewFromWallet(LABEL, 27_110_000, EXECUTOR);

        assertGt(ethRegistrar.lastDuration(), 0, "ETHRegistrar was not used");
        assertEq(ethRenewerV1.lastDuration(), 0, "ETHRenewerV1 should not have been touched");
    }

    /// @dev A premigrated reservation falls through to `ETHRenewerV1`.
    function test_selectsRenewerV1ForPremigratedNames() public {
        ethRegistrar.setRenewable(false);
        ethRenewerV1.setRenewable(true);

        _fundWallet(27_110_000);

        vm.prank(WALLET);
        helper.renewFromWallet(LABEL, 27_110_000, EXECUTOR);

        assertGt(ethRenewerV1.lastDuration(), 0, "ETHRenewerV1 was not used");
        assertEq(ethRegistrar.lastDuration(), 0, "ETHRegistrar should not have been touched");
    }

    /**
     * @dev Migration mid-flight needs no Namepass action.
     *
     * Selection is re-evaluated per renewal rather than cached, so the
     * payment after a migration lands on the other contract by itself.
     */
    function test_selectionFollowsMigrationWithoutIntervention() public {
        ethRegistrar.setRenewable(false);
        ethRenewerV1.setRenewable(true);

        _fundWallet(27_110_000);
        vm.prank(WALLET);
        helper.renewFromWallet(LABEL, 27_110_000, EXECUTOR);

        assertGt(ethRenewerV1.lastDuration(), 0, "pre-migration renewal used the wrong path");

        /* The owner migrates: RESERVED becomes REGISTERED. */
        ethRenewerV1.setRenewable(false);
        ethRegistrar.setRenewable(true);

        _fundWallet(27_110_000);
        vm.prank(WALLET);
        helper.renewFromWallet(LABEL, 27_110_000, EXECUTOR);

        assertGt(ethRegistrar.lastDuration(), 0, "post-migration renewal used the wrong path");
    }

    function test_revertsWhenNeitherRenewerAccepts() public {
        ethRegistrar.setRenewable(false);
        ethRenewerV1.setRenewable(false);

        _fundWallet(27_110_000);

        vm.prank(WALLET);
        vm.expectRevert(ENSV2RenewalHelper.NameNotRenewable.selector);
        helper.renewFromWallet(LABEL, 27_110_000, EXECUTOR);
    }

    /// @dev A retired `ETHRenewerV1` (address zero) must not be called.
    function test_toleratesRetiredRenewerV1() public {
        vm.prank(GOVERNANCE);
        helper.setRenewers(address(ethRegistrar), address(0));

        _fundWallet(27_110_000);

        vm.prank(WALLET);
        helper.renewFromWallet(LABEL, 27_110_000, EXECUTOR);

        assertGt(ethRegistrar.lastDuration(), 0, "renewal failed with V1 retired");
    }

    /*//////////////////////////////////////////////////////////////
                            ACCESS CONTROL
    //////////////////////////////////////////////////////////////*/

    function test_onlyTheDerivedWalletMayCall() public {
        _fundWallet(27_110_000);

        vm.prank(address(0xBAD));
        vm.expectRevert(ENSV2RenewalHelper.InvalidWallet.selector);
        helper.renewFromWallet(LABEL, 27_110_000, EXECUTOR);
    }

    function test_onlyGovernanceMaySetRenewers() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(ENSV2RenewalHelper.NotGovernance.selector);
        helper.setRenewers(address(ethRegistrar), address(0));
    }

    /// @dev The Namepass owner has no say over ENS's contracts.
    function test_ownerMayNotSetRenewers() public {
        vm.expectRevert(ENSV2RenewalHelper.NotGovernance.selector);
        helper.setRenewers(address(ethRegistrar), address(0));
    }

    function test_governanceMayHandOverToASuccessor() public {
        address successor = address(0x5CC);

        vm.prank(GOVERNANCE);
        helper.setGovernanceExecutor(successor);

        assertEq(helper.ensGovernanceExecutor(), successor, "handover did not take");

        vm.prank(GOVERNANCE);
        vm.expectRevert(ENSV2RenewalHelper.NotGovernance.selector);
        helper.setRenewers(address(ethRegistrar), address(0));

        vm.prank(successor);
        helper.setRenewers(address(ethRegistrar), address(0));
    }

    function test_onlyGovernanceMayHandOver() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(ENSV2RenewalHelper.NotGovernance.selector);
        helper.setGovernanceExecutor(address(0x5CC));
    }

    /*//////////////////////////////////////////////////////////////
                               DUST
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Withdrawal, independent of how the residue got there —
     * whether a given payment leaves any is the accounting tests'
     * business, not this one's.
     */
    function test_ownerMayWithdrawDust() public {
        usdc.mint(address(helper), 42);

        helper.withdrawDust(address(0xD57), 42);

        assertEq(usdc.balanceOf(address(0xD57)), 42, "dust was not withdrawn");
        assertEq(usdc.balanceOf(address(helper)), 0, "helper still holds residue");
    }

    function test_onlyOwnerMayWithdrawDust() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(ENSV2RenewalHelper.NotOwner.selector);
        helper.withdrawDust(address(0xBAD), 1);
    }
}
