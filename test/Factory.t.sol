// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {NamepassFactory} from "../contracts/NamepassFactory.sol";
import {NamepassL1Gateway} from "../contracts/NamepassL1Gateway.sol";
import {RenewalHelperPointer} from "../contracts/RenewalHelperPointer.sol";
import {Dummy} from "./mocks/Mocks.sol";

/**
 * @notice Label derivation and the guards around a burn.
 *
 * The deposit address is the product's one permanent promise, so the
 * tests here are mostly about what must *not* be derivable: a label
 * ENS cannot price, a name with a dot, an empty one.
 */
contract FactoryTest is Test {
    uint256 constant MAINNET = 1;
    uint256 constant SEPOLIA = 11155111;

    address constant OWNER = address(0x07E7);

    function _deploy(uint256 hubChainId) internal returns (NamepassFactory) {
        return new NamepassFactory(OWNER, hubChainId);
    }

    /*//////////////////////////////////////////////////////////////
                            HUB CHAIN ID
    //////////////////////////////////////////////////////////////*/

    function test_acceptsTheTwoSupportedHubs() public {
        assertTrue(address(_deploy(MAINNET)) != address(0), "mainnet hub rejected");
        assertTrue(address(_deploy(SEPOLIA)) != address(0), "sepolia hub rejected");
    }

    /**
     * @dev A wrong hub is not a misconfiguration to correct — it is a
     * whole deployment set at wrong addresses, with an L2 that thinks
     * it is the hub and never burns.
     */
    function test_rejectsUnsupportedHubChainIds() public {
        uint256[5] memory bad = [uint256(0), 10, 8453, 42161, 1115511];

        for (uint256 i; i < bad.length; ++i) {
            vm.expectRevert(NamepassFactory.InvalidHubChainId.selector);
            _deploy(bad[i]);
        }
    }

    /*//////////////////////////////////////////////////////////////
                         LABEL DERIVATION
    //////////////////////////////////////////////////////////////*/

    function test_rejectsEmptyLabel() public {
        NamepassFactory f = _deploy(MAINNET);

        vm.expectRevert(NamepassFactory.EmptyLabel.selector);
        f.predictWallet("");
    }

    /// @dev A full name would otherwise derive an address nothing can renew.
    function test_rejectsDottedLabel() public {
        NamepassFactory f = _deploy(MAINNET);

        vm.expectRevert(NamepassFactory.DottedLabel.selector);
        f.predictWallet("vitalik.eth");
    }

    /**
     * @dev ENS's `getBasePrice` returns zero beyond 255 bytes, so a
     * longer label derives an address that is fundable, burnable and
     * impossible to renew.
     */
    function test_rejectsLabelOver255Bytes() public {
        NamepassFactory f = _deploy(MAINNET);

        bytes memory long = new bytes(256);
        for (uint256 i; i < 256; ++i) {
            long[i] = "a";
        }

        vm.expectRevert(NamepassFactory.LabelTooLong.selector);
        f.predictWallet(string(long));
    }

    function test_accepts255ByteLabel() public {
        NamepassFactory f = _deploy(MAINNET);

        bytes memory atLimit = new bytes(255);
        for (uint256 i; i < 255; ++i) {
            atLimit[i] = "a";
        }

        assertTrue(f.predictWallet(string(atLimit)) != address(0), "255 bytes should derive");
    }

    /// @dev Distinct labels must not share a deposit address.
    function test_distinctLabelsHaveDistinctWallets() public {
        NamepassFactory f = _deploy(MAINNET);

        assertTrue(f.predictWallet("vitalik") != f.predictWallet("nick"), "different labels collided");
    }
}

/**
 * @notice The gateway's fixed allowance is a pricing policy. The browser
 * checks its configured value against the chain at boot.
 */
contract ConstantAgreementTest is Test {
    function test_helperAllowanceIsTenCents() public {
        assertEq(_helperAllowance(), 100_000, "GAS_ALLOWANCE changed from $0.10");
    }

    /**
     * @dev Read off a live helper. Every constructor argument is a
     * placeholder — the constructor only checks each is non-zero and
     * has code, and nothing here calls any of them.
     */
    function _helperAllowance() internal returns (uint256) {
        address d = address(new Dummy());

        vm.chainId(11155111);
        RenewalHelperPointer pointer = new RenewalHelperPointer(d, d, d);
        return new NamepassL1Gateway(d, d, d, d, address(pointer), d).GAS_ALLOWANCE();
    }
}
