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
 * @notice The helper inverts ENS's pricing; this checks the inversion
 * against ENS's own forward implementation rather than a restatement
 * of it.
 *
 * Both pricing bugs this codebase has shipped were invisible to a test
 * that mocked the oracle: rates derived from a Julian year, and
 * `getPaymentTokenRatio` read as a single divisor when it returns a
 * numerator and a denominator. The second agreed with the live
 * configuration for every input, because `numer` happens to be 1 —
 * which is why `testFuzz_agreesWithENS_nonUnitNumerator` exists as a
 * separate case rather than trusting the default config to cover it.
 */
contract PricingTest is Test {
    /* Live Sepolia configuration, read off the deployed oracle. */
    uint256 constant RATE_3 = 20_294_267;
    uint256 constant RATE_4 = 5_073_567;
    uint256 constant RATE_5 = 253_679;

    uint128 constant DISCOUNT_DENOMINATOR = 1e38;

    ENSV2RenewalHelper internal helper;
    StandardRentPriceOracle internal oracle;
    MockRenewer internal renewer;
    MockUSDC internal usdc;
    MockFactory internal factory;

    address constant GOVERNANCE = address(0xE45);
    bytes32 constant REFERRER = bytes32(uint256(0x1208));

    function setUp() public {
        usdc = new MockUSDC();
        oracle = _deployOracle(1, 1e6);
        renewer = new MockRenewer(IRentPriceOracle(address(oracle)), address(0xBEEF));
        factory = new MockFactory();

        helper = new ENSV2RenewalHelper(
            address(factory),
            address(usdc),
            address(new MockMessageTransmitter(usdc)),
            address(new Dummy()), /* TokenMessenger, unused here */
            address(renewer),
            address(0),
            GOVERNANCE,
            REFERRER
        );
    }

    function _deployOracle(uint128 numer, uint128 denom)
        internal
        returns (StandardRentPriceOracle)
    {
        uint256[] memory rates = new uint256[](5);
        rates[0] = 0;
        rates[1] = 0;
        rates[2] = RATE_3;
        rates[3] = RATE_4;
        rates[4] = RATE_5;

        DiscountPoint[] memory points = new DiscountPoint[](3);
        points[0] = DiscountPoint({duration: 63_072_000, numer: 875e35});
        points[1] = DiscountPoint({duration: 94_608_000, numer: 6875e34});
        points[2] = DiscountPoint({duration: 189_216_000, numer: 5625e34});

        PaymentRatio[] memory ratios = new PaymentRatio[](1);
        ratios[0] = PaymentRatio({
            paymentToken: IERC20(address(usdc)),
            numer: numer,
            denom: denom
        });

        return new StandardRentPriceOracle(
            address(this),
            rates,
            points,
            DISCOUNT_DENOMINATOR,
            0, /* no premium — renewals never pay one */
            1,
            1,
            ratios
        );
    }

    function _label(uint8 length) internal pure returns (string memory) {
        bytes memory b = new bytes(length);

        for (uint256 i; i < length; ++i) {
            b[i] = "a";
        }

        return string(b);
    }

    /*//////////////////////////////////////////////////////////////
                        THE CENTRAL INVARIANT
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev What the helper thinks ENS will charge must be what ENS
     * says it will charge, and the duration must be the longest the
     * budget actually affords.
     */
    function _assertQuoteAgreesWithENS(
        StandardRentPriceOracle oracle_,
        string memory label,
        uint256 budget
    ) internal view {
        uint64 duration;
        uint256 amountNeeded;

        /*
         * A budget large enough to buy more than `type(uint64).max`
         * seconds is refused rather than truncated — correct, and
         * pinned by `test_absurdBudgetRevertsRatherThanTruncating`.
         * Skip it here so the fuzzer spends its runs on the domain
         * where an agreement can be asserted at all.
         */
        try helper.quote(label, budget) returns (uint64 d, uint256 a) {
            duration = d;
            amountNeeded = a;
        } catch (bytes memory reason) {
            assertEq(
                bytes4(reason),
                ENSV2RenewalHelper.DurationOverflow.selector,
                "quote reverted for a reason other than overflow"
            );
            return;
        }

        if (duration == 0) {
            return;
        }

        /* 1. ENS's forward price for that duration is our number. */
        assertEq(
            oracle_.getRenewPrice(label, 0, duration, IERC20(address(usdc))),
            amountNeeded,
            "helper price disagrees with ENS"
        );

        /* 2. It is affordable. */
        assertLe(amountNeeded, budget, "quote exceeds the budget");

        /* 3. It is maximal — one more second cannot be afforded. */
        assertGt(
            oracle_.getRenewPrice(label, 0, duration + 1, IERC20(address(usdc))),
            budget,
            "a longer duration was affordable"
        );
    }

    /// @dev Up to 10 billion USDC — far past any real deposit.
    uint256 constant MAX_REALISTIC_BUDGET = 1e16;

    function testFuzz_agreesWithENS(uint256 rawBudget, uint8 rawLength) public view {
        uint256 budget = bound(rawBudget, 1, MAX_REALISTIC_BUDGET);
        uint8 length = uint8(bound(rawLength, 3, 15));

        _assertQuoteAgreesWithENS(oracle, _label(length), budget);
    }

    /**
     * @dev The case the live configuration cannot exercise.
     *
     * With `numer == 1` a single-divisor conversion is accidentally
     * correct, which is exactly why the bug survived review. Any other
     * numerator separates the two.
     */
    function testFuzz_agreesWithENS_nonUnitNumerator(uint256 rawBudget) public {
        uint256 budget = bound(rawBudget, 1, MAX_REALISTIC_BUDGET);

        StandardRentPriceOracle skewed = _deployOracle(3, 2e6);
        renewer.setOracle(IRentPriceOracle(address(skewed)));

        _assertQuoteAgreesWithENS(skewed, _label(5), budget);
    }

    function testFuzz_agreesWithENS_acrossRatios(
        uint256 rawBudget,
        uint64 rawNumer,
        uint64 rawDenom
    ) public {
        uint256 budget = bound(rawBudget, 1, MAX_REALISTIC_BUDGET);
        uint128 numer = uint128(bound(rawNumer, 1, 1e12));
        uint128 denom = uint128(bound(rawDenom, 1, 1e12));

        StandardRentPriceOracle skewed = _deployOracle(numer, denom);
        renewer.setOracle(IRentPriceOracle(address(skewed)));

        _assertQuoteAgreesWithENS(skewed, _label(5), budget);
    }

    /**
     * @dev A budget beyond `type(uint64).max` seconds must revert, not
     * wrap. Truncating would sell a duration far shorter than the one
     * paid for.
     */
    function test_absurdBudgetRevertsRatherThanTruncating() public {
        vm.expectRevert(ENSV2RenewalHelper.DurationOverflow.selector);
        helper.quote(_label(5), type(uint96).max);
    }

    /*//////////////////////////////////////////////////////////////
                        DISCOUNT TIER SELECTION
    //////////////////////////////////////////////////////////////*/

    /// @dev The published thresholds, as `docs/FRONTEND.md` states them.
    function test_thresholdsMatchDocumentedFigures() public view {
        (uint64 twoYear,) = helper.quote(_label(5), 14_000_037);
        (uint64 threeYear,) = helper.quote(_label(5), 16_500_044);
        (uint64 sixYear,) = helper.quote(_label(5), 27_000_071);

        assertGe(twoYear, 63_072_000, "2y threshold does not reach its tier");
        assertGe(threeYear, 94_608_000, "3y threshold does not reach its tier");
        assertGe(sixYear, 189_216_000, "6y threshold does not reach its tier");
    }

    /// @dev One micro-unit less must drop below the tier, not round into it.
    function test_oneUnitBelowThresholdMissesTheTier() public view {
        (uint64 duration,) = helper.quote(_label(5), 16_500_043);
        assertLt(duration, 94_608_000, "under-payment still reached the 3-year tier");
    }

    /**
     * @dev $8.00 buys 83 seconds less than a year.
     *
     * The figure the UI shows as "11 months, 30 days" and the reason
     * there is no one-year quick-select. If this changes, the copy in
     * `CLAUDE.md` and `docs/DECISIONS.md` is wrong.
     */
    function test_eightDollarsIsShortOfAYear() public view {
        (uint64 duration,) = helper.quote(_label(5), 8_000_000);

        assertEq(duration, 31_535_917, "the documented 5-char shortfall moved");
        assertEq(31_536_000 - duration, 83, "the 83-second gap moved");
    }

    /*//////////////////////////////////////////////////////////////
                             LABEL BOUNDS
    //////////////////////////////////////////////////////////////*/

    function test_rejectsEmptyLabel() public {
        vm.expectRevert(ENSV2RenewalHelper.InvalidLabel.selector);
        helper.quote("", 1e6);
    }

    /// @dev ENS's own bound. `quote` must not answer where the factory refuses.
    function test_rejectsLabelOver255Bytes() public {
        bytes memory long = new bytes(256);

        for (uint256 i; i < 256; ++i) {
            long[i] = "a";
        }

        vm.expectRevert(ENSV2RenewalHelper.InvalidLabel.selector);
        helper.quote(string(long), 1e6);
    }

    function test_accepts255ByteLabel() public view {
        bytes memory atLimit = new bytes(255);

        for (uint256 i; i < 255; ++i) {
            atLimit[i] = "a";
        }

        (uint64 duration,) = helper.quote(string(atLimit), 1e9);
        assertGt(duration, 0, "255 bytes should still price");
    }

    /**
     * @dev Codepoints, not bytes: a 3-byte UTF-8 character is one
     * character, so a label of three of them prices at the 3-character
     * rate rather than the 9-character one.
     */
    function test_lengthIsCountedInCodepoints() public view {
        (uint64 threeWide,) = helper.quote(unicode"日本語", 1e9);
        (uint64 threeAscii,) = helper.quote(_label(3), 1e9);

        assertEq(threeWide, threeAscii, "multi-byte characters were counted as bytes");
    }

    /*//////////////////////////////////////////////////////////////
                           ORACLE ROBUSTNESS
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev ENS moving its thresholds must not need a Namepass change.
     *
     * Points are read from the oracle on every quote rather than
     * stored, so a governance decision to reshape the tiers — a
     * one-year tier where there was none, a ten-year tier past the
     * old top — is followed automatically. Nothing here encodes 2/3/6
     * years.
     */
    function test_followsChangedDiscountThresholds() public {
        uint256[] memory rates = new uint256[](5);
        rates[2] = RATE_3;
        rates[3] = RATE_4;
        rates[4] = RATE_5;

        /* A completely different shape: 1, 4 and 10 years. */
        DiscountPoint[] memory points = new DiscountPoint[](3);
        points[0] = DiscountPoint({duration: 31_536_000, numer: 9e37});
        points[1] = DiscountPoint({duration: 126_144_000, numer: 6e37});
        points[2] = DiscountPoint({duration: 315_360_000, numer: 4e37});

        PaymentRatio[] memory ratios = new PaymentRatio[](1);
        ratios[0] = PaymentRatio({
            paymentToken: IERC20(address(usdc)),
            numer: 1,
            denom: 1e6
        });

        StandardRentPriceOracle reshaped = new StandardRentPriceOracle(
            address(this), rates, points, DISCOUNT_DENOMINATOR, 0, 1, 1, ratios
        );

        renewer.setOracle(IRentPriceOracle(address(reshaped)));

        /* The invariant still holds against the new shape. */
        _assertQuoteAgreesWithENS(reshaped, _label(5), 27_000_071);
        _assertQuoteAgreesWithENS(reshaped, _label(5), 8_000_000);
        _assertQuoteAgreesWithENS(reshaped, _label(3), 1_000_000_000);

        /* And the new bottom tier is reachable where the old one was not. */
        (uint64 duration,) = helper.quote(_label(5), 8_000_000);
        assertGe(duration, 31_536_000, "the new one-year tier was not applied");
    }

    /**
     * @dev More tiers than ENS ships today, to prove nothing assumes
     * three.
     */
    function test_followsAdditionalDiscountTiers() public {
        uint256[] memory rates = new uint256[](5);
        rates[4] = RATE_5;

        DiscountPoint[] memory points = new DiscountPoint[](5);
        points[0] = DiscountPoint({duration: 31_536_000, numer: 95e36});
        points[1] = DiscountPoint({duration: 63_072_000, numer: 875e35});
        points[2] = DiscountPoint({duration: 94_608_000, numer: 6875e34});
        points[3] = DiscountPoint({duration: 189_216_000, numer: 5625e34});
        points[4] = DiscountPoint({duration: 315_360_000, numer: 4e37});

        PaymentRatio[] memory ratios = new PaymentRatio[](1);
        ratios[0] = PaymentRatio({
            paymentToken: IERC20(address(usdc)),
            numer: 1,
            denom: 1e6
        });

        StandardRentPriceOracle deeper = new StandardRentPriceOracle(
            address(this), rates, points, DISCOUNT_DENOMINATOR, 0, 1, 1, ratios
        );

        renewer.setOracle(IRentPriceOracle(address(deeper)));

        _assertQuoteAgreesWithENS(deeper, _label(5), 40_000_000);
        _assertQuoteAgreesWithENS(deeper, _label(5), 100_000_000);
    }

    /**
     * @dev ENS permits an empty discount array and leaves
     * `DISCOUNT_DENOMINATOR` at zero. Removing the bulk discounts is a
     * governance decision that touches none of the functions this
     * helper calls, so it must not stop renewals.
     */
    function test_worksWithNoDiscountPoints() public {
        uint256[] memory rates = new uint256[](5);
        rates[2] = RATE_3;
        rates[3] = RATE_4;
        rates[4] = RATE_5;

        PaymentRatio[] memory ratios = new PaymentRatio[](1);
        ratios[0] = PaymentRatio({
            paymentToken: IERC20(address(usdc)),
            numer: 1,
            denom: 1e6
        });

        StandardRentPriceOracle flat = new StandardRentPriceOracle(
            address(this),
            rates,
            new DiscountPoint[](0),
            0, /* denominator is not set when there are no points */
            0,
            1,
            1,
            ratios
        );

        assertEq(flat.DISCOUNT_DENOMINATOR(), 0, "expected an unset denominator");

        renewer.setOracle(IRentPriceOracle(address(flat)));

        _assertQuoteAgreesWithENS(flat, _label(5), 27_000_071);
    }
}
