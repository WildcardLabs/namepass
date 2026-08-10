// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {NamepassFactory} from "../contracts/NamepassFactory.sol";
import {ENSV2RenewalHelper} from "../contracts/ENSV2RenewalHelper.sol";
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

    /// @dev Same label, same address — the whole promise.
    function test_predictionIsDeterministic() public {
        NamepassFactory f = _deploy(MAINNET);

        assertEq(f.predictWallet("vitalik"), f.predictWallet("vitalik"), "prediction moved");
        assertTrue(
            f.predictWallet("vitalik") != f.predictWallet("nick"),
            "different labels collided"
        );
    }

    /**
     * @dev Two hubs are two deployments, and must stay so.
     *
     * Asserted on the creation code rather than on two live instances,
     * because that is the actual mechanism: constructor arguments are
     * part of the creation code, the factory is deployed with CREATE2,
     * and its address is what every deposit address derives from. Same
     * creation code would mean a testnet payment landing on a mainnet
     * address.
     */
    function test_hubChainIdSeparatesDeployments() public pure {
        bytes32 mainnet = keccak256(
            abi.encodePacked(type(NamepassFactory).creationCode, abi.encode(OWNER, MAINNET))
        );

        bytes32 sepolia = keccak256(
            abi.encodePacked(type(NamepassFactory).creationCode, abi.encode(OWNER, SEPOLIA))
        );

        assertTrue(mainnet != sepolia, "both hubs produce the same factory address");
    }
}

/**
 * @notice The one number that lives in three places with nothing
 * linking them.
 *
 * `ENSV2RenewalHelper.GAS_ALLOWANCE` is on Ethereum,
 * `NamepassFactory.MIN_BURN_AMOUNT` is on every L2 and cannot read it
 * cross-chain, and `src/lib/fees.ts` is in the browser. Only a test can
 * notice them drifting apart.
 */
contract ConstantAgreementTest is Test {
    /**
     * @dev Must equal `GAS_ALLOWANCE` in `src/lib/fees.ts`.
     *
     * The UI quotes send amounts that carry the allowance and solves
     * durations from `budget - allowance`. If the chain takes a
     * different figure, every quoted duration is wrong.
     */
    uint256 constant FEES_TS_GAS_ALLOWANCE = 100_000;

    /// @dev The dearest second ENS sells: a 3-character name.
    uint256 constant DEAREST_SECOND = 21;

    function test_helperAllowanceMatchesTheFrontend() public {
        assertEq(
            _helperAllowance(),
            FEES_TS_GAS_ALLOWANCE,
            "GAS_ALLOWANCE drifted from src/lib/fees.ts"
        );
    }

    /**
     * @dev The L2 burn floor must leave enough for the allowance plus
     * at least one second, or a burn produces an unclaimable message.
     */
    function test_minBurnAmountClearsTheAllowancePlusASecond() public {
        assertGe(
            _minBurnAmount(),
            _helperAllowance() + DEAREST_SECOND,
            "MIN_BURN_AMOUNT no longer covers the allowance plus a second"
        );
    }

    /**
     * @dev Read off a live helper. Every constructor argument is a
     * placeholder — the constructor only checks each is non-zero and
     * has code, and nothing here calls any of them.
     */
    function _helperAllowance() internal returns (uint256) {
        address d = address(new Dummy());

        return new ENSV2RenewalHelper(
            d, d, d, d, d, address(0), address(0xE45), bytes32(uint256(0x1208))
        ).GAS_ALLOWANCE();
    }

    /// @dev `MIN_BURN_AMOUNT` is private, so this mirrors it deliberately.
    function _minBurnAmount() internal pure returns (uint256) {
        return 110_000;
    }
}
