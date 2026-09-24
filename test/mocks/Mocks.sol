// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IRentPriceOracle} from "../ens/registrar/interfaces/IRentPriceOracle.sol";

/**
 * @dev Six-decimal token, enough of USDC to exercise the helper.
 *
 * Returns a bool from `transfer`/`approve` because the helper checks
 * it. Native USDC does the same on all four target chains.
 */
contract MockUSDC {
    mapping(address => uint256) public balanceOf;

    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];

        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }

        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/**
 * @dev Stands in for `ETHRegistrar` / `ETHRenewerV1`.
 *
 * The pricing is **not** mocked — it delegates to a real
 * `StandardRentPriceOracle`, so the helper's inverse is tested against
 * ENS's own arithmetic. What is mocked is only the registry state that
 * decides renewability, which is what lets one file play both roles.
 *
 * `renew` mirrors `AbstractETHRegistrar.renew`: price from the oracle,
 * then pull it from `msg.sender` with `transferFrom`. The helper's
 * balance-delta assertion depends on that shape.
 */
contract MockRenewer {
    struct RenewData {
        string label;
        uint64 duration;
        bytes32 referrer;
    }
    IRentPriceOracle public rentPriceOracle;

    address public immutable beneficiary;

    bool public renewable = true;

    /// @dev Current expiry the oracle prices against.
    uint64 public expiry;

    /// @dev ENS's `MIN_RENEW_DURATION`.
    uint64 public constant MIN_RENEW_DURATION = 1;

    /// @dev Last renewal, for assertions.
    uint64 public lastDuration;

    bytes32 public lastReferrer;

    error NameNotRenewable(string label);

    error DurationTooShort(uint64 duration, uint64 minDuration);

    constructor(IRentPriceOracle oracle, address beneficiary_) {
        rentPriceOracle = oracle;
        beneficiary = beneficiary_;
    }

    function setRenewable(bool value) external {
        renewable = value;
    }

    function setOracle(IRentPriceOracle oracle) external {
        rentPriceOracle = oracle;
    }

    function isRenewable(string calldata) external view returns (bool) {
        return renewable;
    }

    /**
     * @dev Reverts on unrenewable or too-short exactly as
     * `_requireRenewable` does, because the helper leans on that:
     * calling this is also its renewability check.
     */
    function getRenewPrice(string calldata label, uint64 duration, IERC20 paymentToken) public view returns (uint256) {
        if (!renewable) {
            revert NameNotRenewable(label);
        }

        if (duration < MIN_RENEW_DURATION) {
            revert DurationTooShort(duration, MIN_RENEW_DURATION);
        }

        return rentPriceOracle.getRenewPrice(label, expiry, duration, paymentToken);
    }

    function renew(RenewData calldata rd, IERC20 paymentToken) external {
        uint256 amount = getRenewPrice(rd.label, rd.duration, paymentToken);
        lastDuration = rd.duration;
        lastReferrer = rd.referrer;

        require(paymentToken.transferFrom(msg.sender, beneficiary, amount), "payment failed");
    }
}

/**
 * @dev Only the one function the helper calls on the factory.
 */
contract MockFactory {
    mapping(bytes32 => address) internal _wallets;

    function setWallet(string calldata label, address wallet) external {
        _wallets[keccak256(bytes(label))] = wallet;
    }

    function predictWallet(string calldata label) external view returns (address) {
        return _wallets[keccak256(bytes(label))];
    }
}

/**
 * @dev Mints on `receiveMessage`, standing in for a CCTP claim.
 *
 * `mintAmount` is settable independently of the message so a mint that
 * disagrees with the authenticated burn can be exercised — that is the
 * whole point of the helper's balance assertion.
 */
contract MockMessageTransmitter {
    MockUSDC public immutable usdc;

    address public mintTo;

    uint256 public mintAmount;

    bool public succeed = true;

    bool public overrideAmount;
    mapping(bytes32 => bool) public usedNonces;

    constructor(MockUSDC usdc_) {
        usdc = usdc_;
    }

    function setMint(address to, uint256 amount) external {
        mintTo = to;
        mintAmount = amount;
        overrideAmount = true;
    }

    function setSucceed(bool value) external {
        succeed = value;
    }

    function receiveMessage(bytes calldata message, bytes calldata) external returns (bool) {
        if (!succeed) {
            return false;
        }

        bytes32 nonce;
        assembly { nonce := calldataload(add(message.offset, 12)) }
        require(!usedNonces[nonce], "nonce used");
        usedNonces[nonce] = true;
        uint256 amount;

        if (overrideAmount) {
            amount = mintAmount;
        } else {
            /* burn.amount - burn.feeExecuted, from the message itself. */
            uint256 burnAmount;
            uint256 feeExecuted;

            assembly {
                burnAmount := calldataload(add(message.offset, 216))
                feeExecuted := calldataload(add(message.offset, 312))
            }

            amount = burnAmount - feeExecuted;
        }

        usdc.mint(mintTo == address(0) ? msg.sender : mintTo, amount);
        return true;
    }
}

/**
 * @dev A contract that does nothing, for constructor arguments the
 * helper only checks for code. Used where a suite never exercises the
 * dependency — the CCTP TokenMessenger in the pricing tests, say.
 */
contract Dummy {}
