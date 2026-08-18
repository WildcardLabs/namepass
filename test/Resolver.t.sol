// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {NamepassResolver} from "../contracts/NamepassResolver.sol";

/**
 * @notice ENSIP-10 wildcard resolution and the ERC-3668 gateway callback.
 *
 * The load-bearing test is `test_callbackDerivesTheDepositWallet`. The address
 * the resolver returns must equal the factory's `predictWallet` and the address
 * the app shows, or a funder pays an address nobody watches. The known answers
 * below come from an independent CREATE2 implementation; `vitalik` equals the
 * on-chain value in `docs/DEPLOYMENTS.md`, which anchors the rest.
 */
contract ResolverTest is Test {
    NamepassResolver internal resolver;

    address constant APEX = address(0xA9E1);
    string constant GATEWAY = "https://namepass.example/api/ccip";

    bytes4 constant ADDR = 0xf1cb7e06; // addr(bytes32,uint256)
    bytes4 constant TEXT = 0x59d1d43c; // text(bytes32,string)
    uint256 constant COIN_ETH = 60;

    function setUp() public {
        resolver = new NamepassResolver(
            APEX,
            "avatar-uri",
            "the description",
            "https://namepass.example",
            GATEWAY
        );
    }

    /*//////////////////////////////////////////////////////////////
                              NAME ENCODING
    //////////////////////////////////////////////////////////////*/

    /** DNS wire name for `namepass.eth`. */
    function _apex() internal pure returns (bytes memory) {
        return abi.encodePacked(uint8(8), "namepass", uint8(3), "eth", uint8(0));
    }

    /** DNS wire name for `<label>.namepass.eth`. */
    function _sub(string memory label) internal pure returns (bytes memory) {
        return abi.encodePacked(
            uint8(bytes(label).length), label, uint8(8), "namepass", uint8(3), "eth", uint8(0)
        );
    }

    function _addr(uint256 coinType) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(ADDR, bytes32(0), coinType);
    }

    function _text(string memory key) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(TEXT, bytes32(0), key);
    }

    function _decodeAddress(bytes memory result) internal pure returns (address) {
        bytes memory inner = abi.decode(result, (bytes));
        require(inner.length == 20, "not an address");
        return address(bytes20(inner));
    }

    function _isEmpty(bytes memory result) internal pure returns (bool) {
        return abi.decode(result, (bytes)).length == 0;
    }

    /*//////////////////////////////////////////////////////////////
                                  APEX
    //////////////////////////////////////////////////////////////*/

    function test_apexReturnsConfiguredAddress() public view {
        assertEq(_decodeAddress(resolver.resolve(_apex(), _addr(COIN_ETH))), APEX);
    }

    function test_apexAnswersEvmChainCoinTypes() public view {
        // ENSIP-11 cointype `0x80000000 | chainId`. The deposit address is the
        // same on every EVM chain, so the apex answers all of them.
        uint256 baseCoin = 0x80000000 | uint256(8453);
        assertEq(_decodeAddress(resolver.resolve(_apex(), _addr(baseCoin))), APEX);
    }

    function test_apexIgnoresNonEvmCoinTypes() public view {
        assertTrue(_isEmpty(resolver.resolve(_apex(), _addr(0))), "bitcoin cointype");
    }

    /*//////////////////////////////////////////////////////////////
                           SUBNAME / OFFCHAIN
    //////////////////////////////////////////////////////////////*/

    function test_subnameRevertsOffchainLookupWithLabel() public {
        string[] memory urls = new string[](1);
        urls[0] = GATEWAY;
        bytes memory expected = abi.encodeWithSelector(
            NamepassResolver.OffchainLookup.selector,
            address(resolver),
            urls,
            bytes("vitalik"),
            NamepassResolver.resolveCallback.selector,
            bytes("vitalik")
        );
        vm.expectRevert(expected);
        resolver.resolve(_sub("vitalik"), _addr(COIN_ETH));
    }

    function test_subnameIgnoresNonEvmCoinBeforeLookup() public view {
        // A non-EVM cointype returns empty rather than triggering a gateway call.
        assertTrue(_isEmpty(resolver.resolve(_sub("vitalik"), _addr(0))), "should not look up");
    }

    /*//////////////////////////////////////////////////////////////
                                CALLBACK
    //////////////////////////////////////////////////////////////*/

    function _callback(string memory label) internal view returns (address) {
        return _decodeAddress(resolver.resolveCallback(abi.encode(true), bytes(label)));
    }

    function test_callbackDerivesTheDepositWallet() public view {
        assertEq(_callback("vitalik"), 0x043c184003266644372bA5fA4946777b3f1cFC3D);
        assertEq(_callback("nick"), 0x64EfF4dd0A4c287832A6cDB3Eb94618b78AC0276);
        assertEq(_callback("namepass"), 0xAF34cB930f362bE3fD07FbC837BE56ee2F257dDd);
        assertEq(_callback("abc"), 0x21aA96d7fCac40Fe916A9d82BD1DF72eC8C64Be5);
    }

    function test_callbackRejectsUnconfirmedRegistration() public {
        vm.expectRevert(NamepassResolver.RegistrationFailed.selector);
        resolver.resolveCallback(abi.encode(false), bytes("vitalik"));
    }

    function test_callbackRejectsEmptyResponse() public {
        vm.expectRevert(NamepassResolver.RegistrationFailed.selector);
        resolver.resolveCallback("", bytes("vitalik"));
    }

    /*//////////////////////////////////////////////////////////////
                              TEXT RECORDS
    //////////////////////////////////////////////////////////////*/

    function test_apexReturnsTextRecords() public view {
        assertEq(abi.decode(resolver.resolve(_apex(), _text("avatar")), (string)), "avatar-uri");
        assertEq(abi.decode(resolver.resolve(_apex(), _text("description")), (string)), "the description");
        assertEq(abi.decode(resolver.resolve(_apex(), _text("url")), (string)), "https://namepass.example");
    }

    function test_apexReturnsEmptyForUnknownTextKey() public view {
        assertEq(abi.decode(resolver.resolve(_apex(), _text("com.twitter")), (string)), "");
    }

    function test_subnameHasNoTextRecords() public view {
        assertEq(abi.decode(resolver.resolve(_sub("vitalik"), _text("avatar")), (string)), "");
    }

    /*//////////////////////////////////////////////////////////////
                                INTERFACE
    //////////////////////////////////////////////////////////////*/

    function test_supportsInterface() public view {
        assertTrue(resolver.supportsInterface(0x9061b923), "ENSIP-10 resolve");
        assertTrue(resolver.supportsInterface(0x01ffc9a7), "ERC-165");
        assertFalse(resolver.supportsInterface(0xffffffff), "sentinel");
        assertFalse(resolver.supportsInterface(0x3b3b57de), "legacy addr(bytes32)");
    }
}
