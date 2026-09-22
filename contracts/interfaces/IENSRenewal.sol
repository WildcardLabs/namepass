// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IENSExpiryRegistry {
    function findExpiry(string calldata label) external view returns (uint64);
}

interface IENSV2PriceOracle {
    struct DiscountPoint {
        uint64 duration;
        uint128 numer;
    }

    function DISCOUNT_DENOMINATOR() external view returns (uint128);

    function getBaseRates() external view returns (uint256[] memory);

    function getDiscountPoints() external view returns (DiscountPoint[] memory);

    /**
     * @dev Two values, not one. ENS converts a standard-unit price
     * into payment-token units as `ceil(value * numer / denom)`.
     */
    function getPaymentTokenRatio(IERC20 paymentToken) external view returns (uint128 numer, uint128 denom);
}

/**
 * @dev ENS's `IETHRenewer`. Both `ETHRegistrar` and `ETHRenewerV1`
 * implement it through `AbstractETHRegistrar`, which is what lets one
 * code path drive either.
 */
interface IETHRenewer {
    function ETH_REGISTRY() external view returns (IENSExpiryRegistry);
    /**
     * @dev Whether *this* renewer is the one that can renew `label`.
     * The two implementations have deliberately disjoint predicates,
     * so at most one answers true.
     */
    function isRenewable(string calldata label) external view returns (bool);

    struct RenewData {
        string label;
        uint64 duration;
        bytes32 referrer;
    }

    function renew(RenewData calldata rd, IERC20 paymentToken) external;

    /**
     * @dev The oracle this renewer actually prices with. Read on
     * every quote rather than stored here, so the two can never
     * disagree.
     */
    function rentPriceOracle() external view returns (IENSV2PriceOracle);

    /**
     * @dev ENS's own answer for what a renewal costs. Checked
     * against this contract's inverse calculation before approving
     * anything.
     *
     * Reverts if the name is not renewable by this contract or if
     * `duration` is under `MIN_RENEW_DURATION`, so calling it is also
     * a renewability and minimum-duration check at the exact moment
     * of purchase.
     */
    function getRenewPrice(string calldata label, uint64 duration, IERC20 paymentToken) external view returns (uint256);
}
