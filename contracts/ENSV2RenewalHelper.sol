// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IETHRenewer, IENSV2PriceOracle} from "./interfaces/IENSRenewal.sol";
import {INamepassRenewalHelper} from "./interfaces/INamepassRenewalHelper.sol";

/// @notice Immutable ENS adapter. Only the fixed gateway can fund execution.
contract ENSV2RenewalHelper is INamepassRenewalHelper {
    uint256 private constant MAX_LABEL_BYTES = 255;
    uint256 public constant interfaceVersion = 1;
    address public immutable gateway;
    address public immutable factory;
    address public immutable paymentToken;
    IERC20 private immutable USDC;
    IETHRenewer public immutable ethRegistrar;
    IETHRenewer public immutable ethRenewerV1;
    bytes32 public immutable referrer;

    error NotGateway();
    error InvalidAddress();
    error InvalidLabel();
    error InvalidOracleConfig();
    error InsufficientAmount();
    error ApprovalFailed();
    error TransferFailed();
    error DurationOverflow();
    error UnexpectedRenewalPrice();
    error NameNotRenewable();
    error UnexpectedBalance();

    constructor(address gateway_, address factory_, address usdc_, address registrar_, address v1_, bytes32 referrer_) {
        if (
            gateway_.code.length == 0 || factory_.code.length == 0 || usdc_.code.length == 0
                || registrar_.code.length == 0 || (v1_ != address(0) && v1_.code.length == 0)
        ) revert InvalidAddress();
        gateway = gateway_;
        factory = factory_;
        paymentToken = usdc_;
        USDC = IERC20(usdc_);
        ethRegistrar = IETHRenewer(registrar_);
        ethRenewerV1 = IETHRenewer(v1_);
        referrer = referrer_;
    }

    /// @notice Quote a renewal budget after the gateway allowance has been removed.
    function quote(string calldata label, uint256 budget)
        external
        view
        returns (uint64 duration, uint256 amountNeeded)
    {
        _validateLabel(label);
        return _quote(_selectRenewer(label), label, budget);
    }

    /// @notice Return the selected renewer, or zero if neither renewer accepts the label.
    function renewableBy(string calldata label) public view returns (address) {
        _validateLabel(label);
        if (ethRegistrar.isRenewable(label)) return address(ethRegistrar);
        if (address(ethRenewerV1) != address(0) && ethRenewerV1.isRenewable(label)) return address(ethRenewerV1);
        return address(0);
    }

    /// @notice Keep ENS registry reads behind the replaceable adapter interface.
    function nameState(string calldata label) external view returns (uint64 expiry, address renewer) {
        renewer = renewableBy(label);
        IETHRenewer reader = renewer == address(0) ? ethRegistrar : IETHRenewer(renewer);
        expiry = reader.ETH_REGISTRY().findExpiry(label);
    }

    /// @notice Spend only this call's budget. Return unused units to the gateway.
    function execute(string calldata label, uint256 budget) external returns (uint64 duration, uint256 charged) {
        if (msg.sender != gateway) revert NotGateway();
        _validateLabel(label);
        IETHRenewer renewer = _selectRenewer(label);
        uint256 needed;
        (duration, needed) = _quote(renewer, label, budget);
        if (duration == 0 || needed == 0 || needed > budget) revert InsufficientAmount();
        uint256 beforeBalance = USDC.balanceOf(address(this));
        if (!USDC.transferFrom(gateway, address(this), budget)) revert TransferFailed();
        if (USDC.balanceOf(address(this)) != beforeBalance + budget) revert UnexpectedBalance();
        charged = _settle(renewer, label, duration, needed);
        uint256 remainder = budget - charged;
        if (remainder != 0 && !USDC.transfer(gateway, remainder)) revert TransferFailed();
        if (USDC.balanceOf(address(this)) != beforeBalance) revert UnexpectedBalance();
    }

    function _validateLabel(string memory label) private pure {
        bytes memory raw = bytes(label);
        if (raw.length == 0 || raw.length > MAX_LABEL_BYTES) revert InvalidLabel();
        for (uint256 i; i < raw.length; ++i) {
            if (raw[i] == 0x2e) revert InvalidLabel();
        }
    }

    function _settle(IETHRenewer renewer_, string memory label, uint64 duration, uint256 amountNeeded)
        private
        returns (uint256 charged)
    {
        /*
         * The invariant: what Namepass thinks ENS will charge must
         * equal what ENS itself says it will charge.
         *
         * `_quote` inverts the oracle's pricing to find the longest
         * affordable duration. That inversion is this contract's
         * own work, and the label length feeding it is too. Asking
         * the registrar for the forward price of the duration just
         * chosen turns every way that could be wrong — a length
         * counted differently, a rounding step transcribed wrongly,
         * an oracle shape this code does not anticipate — into a
         * revert before any approval exists, rather than a silent
         * mis-buy.
         */
        if (renewer_.getRenewPrice(label, duration, USDC) != amountNeeded) {
            revert UnexpectedRenewalPrice();
        }

        /*
         * Approve only what this specific renewal needs.
         */
        if (!USDC.approve(address(renewer_), amountNeeded)) {
            revert ApprovalFailed();
        }

        uint256 beforeRenew = USDC.balanceOf(address(this));

        renewer_.renew(IETHRenewer.RenewData(label, duration, referrer), USDC);

        /*
         * What the registrar actually took, not what it was quoted.
         *
         * The registrar prices independently and pulls with
         * transferFrom, so the only authority on the amount charged
         * is the balance movement. This is what `Renewed` reports.
         */
        unchecked {
            charged = beforeRenew - USDC.balanceOf(address(this));
        }

        if (charged != amountNeeded) {
            revert UnexpectedRenewalPrice();
        }

        /*
         * Clear anything the registrar did not pull. Unreachable
         * while the assertion above holds, and kept because the cost
         * of being wrong about that is a standing allowance rather
         * than a one-off.
         */
        if (!USDC.approve(address(renewer_), 0)) {
            revert ApprovalFailed();
        }
    }

    function _quote(IETHRenewer renewer_, string memory label, uint256 usdcAvailable)
        private
        view
        returns (uint64 duration, uint256 amountNeeded)
    {
        /*
         * Every input comes from the oracle the *selected* renewer
         * prices with, fetched fresh. Reading the oracle from
         * anywhere other than the contract about to be called is how
         * the three-way agreement below stops being an invariant. Nothing about the pricing is
         * this contract's own opinion except the inverse search
         * below, and `_settle` checks that against the registrar
         * before it approves anything.
         */
        IENSV2PriceOracle oracle_ = renewer_.rentPriceOracle();

        uint256 rate = _rateFor(oracle_, label);

        (uint128 tokenNumer, uint128 tokenDenom) = oracle_.getPaymentTokenRatio(USDC);

        if (tokenNumer == 0 || tokenDenom == 0) {
            revert InvalidOracleConfig();
        }

        IENSV2PriceOracle.DiscountPoint[] memory points = oracle_.getDiscountPoints();

        /*
         * Only meaningful when there are discounts to scale.
         *
         * ENS permits an empty discount array and leaves
         * `DISCOUNT_DENOMINATOR` at zero in that case, so requiring
         * it unconditionally would turn "ENS governance removed the
         * bulk discounts" into "Namepass stops renewing" — a
         * decision that touches none of the functions this contract
         * calls. With no points the loop below never runs and the
         * denominator is never used, so the full-price path carries
         * on unaffected.
         */
        uint256 denominator;

        if (points.length != 0) {
            denominator = oracle_.DISCOUNT_DENOMINATOR();

            if (denominator == 0) {
                revert InvalidOracleConfig();
            }
        }

        /*
         * Invert ENS's payment conversion.
         *
         * Forward, ENS charges `ceil(standard * numer / denom)`
         * token units. So a token budget affords every standard
         * price S with `ceil(S * numer / denom) <= usdcAvailable`,
         * which is exactly `S <= floor(usdcAvailable * denom /
         * numer)`. Anything simpler — treating the ratio as a single
         * divisor — is only right when `numer` is 1, and silently
         * mis-prices the moment ENS configures it otherwise.
         */
        uint256 budget = usdcAvailable * uint256(tokenDenom) / uint256(tokenNumer);

        uint256 candidate;

        /*
         * Walk discount tiers from the longest / best discount
         * backwards.
         *
         * The first tier whose minimum duration is affordable is
         * necessarily the optimal tier — but only if durations
         * ascend and numerators descend across the array. That
         * ordering is a property of an oracle this contract does not
         * own, so `_validatePoints` asserts it rather than assuming
         * it: a reordered oracle should stop renewals, not quietly
         * mis-price them.
         */
        _validatePoints(points);

        for (uint256 i = points.length; i != 0;) {
            unchecked {
                --i;
            }

            IENSV2PriceOracle.DiscountPoint memory point = points[i];

            /*
             * Exact inverse of ENS's floor:
             *
             * floor(
             *     rate * duration * numer
             *     / denominator
             * ) <= budget
             */
            candidate = ((budget + 1) * denominator - 1) / (rate * uint256(point.numer));

            if (candidate >= uint256(point.duration)) {
                if (candidate > type(uint64).max) {
                    revert DurationOverflow();
                }

                // casting to 'uint64' is safe because the bound is
                // checked immediately above
                duration =
                // forge-lint: disable-next-line(unsafe-typecast)
                uint64(candidate);

                /*
                 * Match ENS's discounted standard-unit price.
                 */
                uint256 standardAmount = rate * uint256(duration) * uint256(point.numer) / denominator;

                /*
                 * Match ENS's ceiling conversion into USDC units.
                 */
                amountNeeded = _toPaymentUnits(standardAmount, tokenNumer, tokenDenom);

                return (duration, amountNeeded);
            }
        }

        /*
         * No discount tier is affordable.
         */
        candidate = budget / rate;

        if (candidate > type(uint64).max) {
            revert DurationOverflow();
        }

        // casting to 'uint64' is safe because the bound is checked
        // immediately above
        duration =
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64(candidate);

        amountNeeded = _toPaymentUnits(rate * uint256(duration), tokenNumer, tokenDenom);
    }

    /**
     * @dev Picks the ENS contract that can actually renew `label`.
     *
     * Asks ENS rather than deciding: `isRenewable` is where ENS keeps
     * the renewal-state logic, and the alternative — reading registry
     * status and reimplementing `RESERVED` versus `REGISTERED` here —
     * is a copy that goes stale the moment ENS adjusts it.
     *
     * `ethRegistrar` is tried first because it is the steady state;
     * `ethRenewerV1` only matches names still awaiting migration and
     * stops matching anything once migration completes. The two
     * predicates are disjoint, so the order is a preference for the
     * common case rather than a tie-break.
     */
    function _selectRenewer(string memory label) private view returns (IETHRenewer) {
        IETHRenewer renewer_ = ethRegistrar;

        if (renewer_.isRenewable(label)) {
            return renewer_;
        }

        renewer_ = ethRenewerV1;

        if (address(renewer_) != address(0) && renewer_.isRenewable(label)) {
            return renewer_;
        }

        /*
         * Expired, in premium auction, never registered, or awaiting
         * a migration step. Reverting leaves the payment where it is
         * — at the deposit address on Ethereum, or as an unclaimed
         * CCTP message that stays replayable — rather than spending
         * it on a renewal that cannot happen.
         */
        revert NameNotRenewable();
    }

    /**
     * @dev ENS's standard-units-to-payment-token conversion, in the
     * forward direction: `ceil(standardAmount * numer / denom)`.
     *
     * Kept as one function so the two call sites — the discounted
     * tier and the full-price fallback — cannot drift apart, and so
     * it reads as the exact inverse of the budget calculation in
     * `_quote`.
     */
    function _toPaymentUnits(uint256 standardAmount, uint128 numer, uint128 denom) private pure returns (uint256) {
        return (standardAmount * uint256(numer) + uint256(denom) - 1) / uint256(denom);
    }

    /**
     * @dev Selects the base rate for a label from the oracle's rate
     * array.
     *
     * Split out of `_quote` for stack depth. The index is the one
     * value on this path that is computed here rather than read from
     * ENS — see `_strlen`.
     */
    function _rateFor(IENSV2PriceOracle oracle_, string memory label) private view returns (uint256 rate) {
        uint256 rawLength = bytes(label).length;

        /*
         * The same bound ENS applies in `getBasePrice`, which returns
         * zero outside it. Mirrored here so the two public entry
         * points cannot disagree: without it `quote()` answers for a
         * label `NamepassFactory.predictWallet` refuses, which is
         * only ever a way to mislead someone about a name they can
         * never fund.
         */
        if (rawLength == 0 || rawLength > MAX_LABEL_BYTES) {
            revert InvalidLabel();
        }

        uint256[] memory rates = oracle_.getBaseRates();

        if (rates.length == 0) {
            revert InvalidOracleConfig();
        }

        uint256 length = _strlen(label);

        if (length > rates.length) {
            length = rates.length;
        }

        rate = rates[length - 1];

        if (rate == 0) {
            revert InvalidLabel();
        }
    }

    /**
     * @dev Requires discount points to ascend by duration and
     * descend by numerator, which is what makes "the first
     * affordable tier walking backwards" the optimal one.
     *
     * A separate function for stack depth as much as for clarity —
     * carrying the two comparison variables inside `_quote` put it
     * over the limit under the pinned optimizer settings.
     */
    function _validatePoints(IENSV2PriceOracle.DiscountPoint[] memory points) private pure {
        uint256 previousDuration = type(uint256).max;

        uint128 previousNumer;

        for (uint256 i = points.length; i != 0;) {
            unchecked {
                --i;
            }

            IENSV2PriceOracle.DiscountPoint memory point = points[i];

            if (point.numer == 0) {
                revert InvalidOracleConfig();
            }

            if (uint256(point.duration) >= previousDuration || (previousNumer != 0 && point.numer <= previousNumer)) {
                revert InvalidOracleConfig();
            }

            previousDuration = uint256(point.duration);

            previousNumer = point.numer;
        }
    }

    /*//////////////////////////////////////////////////////////////
                         UTF-8 LENGTH
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Counts UTF-8 code points, which is what indexes the
     * oracle's base-rate array.
     *
     * The arithmetic below this is ENS's — its rates, its rounding.
     * This function is the one input that is ours, so it is the only
     * place the quote can disagree with what the registrar charges.
     * For ASCII labels it cannot: one byte, one code point, whatever
     * rule either side applies. It is worth a differential test
     * against the deployed oracle for non-ASCII labels before
     * mainnet.
     *
     * The 5- and 6-byte branches are dead under RFC 3629, which
     * caps UTF-8 at four. They are kept anyway because this is a
     * transcription of ENS's own `strlen`, and the requirement is to
     * agree with the registrar rather than to be independently
     * correct. On malformed input a shorter walk would count more
     * code points than ENS does, pick a shorter length, and quote a
     * dearer rate than the one actually charged. Parity is the
     * specification here; do not "fix" these away.
     *
     * Consequence worth knowing: emoji are counted by code point, so
     * a ZWJ sequence like a family emoji is five characters, not
     * one, and a variation selector adds one. That is ENS's
     * behaviour and therefore ours.
     */
    function _strlen(string memory value) private pure returns (uint256 length) {
        bytes memory data = bytes(value);

        uint256 i;

        while (i < data.length) {
            bytes1 b = data[i];

            if (b < 0x80) {
                i += 1;
            } else if (b < 0xE0) {
                i += 2;
            } else if (b < 0xF0) {
                i += 3;
            } else if (b < 0xF8) {
                i += 4;
            } else if (b < 0xFC) {
                i += 5;
            } else {
                i += 6;
            }

            unchecked {
                ++length;
            }
        }
    }
}
