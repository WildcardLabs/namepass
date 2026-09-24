// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {NamepassL1Gateway} from "../contracts/NamepassL1Gateway.sol";
import {RenewalHelperPointer} from "../contracts/RenewalHelperPointer.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {ENSV2RenewalHelper} from "../contracts/ENSV2RenewalHelper.sol";

import {StandardRentPriceOracle, DiscountPoint, PaymentRatio} from "./ens/registrar/StandardRentPriceOracle.sol";
import {IRentPriceOracle} from "./ens/registrar/interfaces/IRentPriceOracle.sol";

import {MockUSDC, MockRenewer, MockFactory, MockMessageTransmitter, Dummy} from "./mocks/Mocks.sol";

/**
 * @notice CCTP v2 message parsing and the route checks around it.
 *
 * The offsets are the part of this contract that cannot be reasoned
 * about from the outside — a wrong one reads a plausible-looking value
 * from the wrong field and the failure is silent. `_encode` below builds
 * messages to the published layout so the constants are exercised
 * against a real encoding rather than against themselves.
 */
contract CCTPTest is Test {
    NamepassL1Gateway internal helper;
    ENSV2RenewalHelper internal adapter;
    RenewalHelperPointer internal pointer;
    MockRenewer internal renewer;
    MockUSDC internal usdc;
    MockFactory internal factory;
    MockMessageTransmitter internal transmitter;

    address constant GOVERNANCE = address(0xE45);
    bytes32 constant REFERRER = bytes32(uint256(0x1208));
    address constant EXECUTOR = address(0xEE);
    address constant WALLET = address(0xA11E7);
    address constant TOKEN_MESSENGER = address(0xC1C1E);

    string constant LABEL = "vitalik";

    function setUp() public {
        vm.chainId(11155111);
        vm.etch(GOVERNANCE, hex"00");
        usdc = new MockUSDC();

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

        StandardRentPriceOracle oracle =
            new StandardRentPriceOracle(address(this), rates, points, 1e38, 0, 1, 1, ratios);

        renewer = new MockRenewer(IRentPriceOracle(address(oracle)), address(0xB1));
        factory = new MockFactory();
        factory.setWallet(LABEL, WALLET);

        transmitter = new MockMessageTransmitter(usdc);

        /* TOKEN_MESSENGER only needs code for the constructor's check. */
        vm.etch(TOKEN_MESSENGER, hex"00");

        pointer = new RenewalHelperPointer(address(factory), address(usdc), GOVERNANCE);
        helper = new NamepassL1Gateway(
            address(factory), address(usdc), address(transmitter), TOKEN_MESSENGER, address(pointer), address(0xD57)
        );
        adapter = new ENSV2RenewalHelper(
            address(helper), address(factory), address(usdc), address(renewer), address(0), REFERRER
        );
        vm.prank(GOVERNANCE);
        pointer.setHelper(address(adapter));

        /*
         * No `setMint` here on purpose: the transmitter's default
         * mints `burn.amount - burn.feeExecuted` to its caller, which
         * is the helper. Overriding is only for the tests that need a
         * mint disagreeing with the message.
         */
    }

    /*//////////////////////////////////////////////////////////////
                          MESSAGE ENCODING
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Builds a CCTP v2 message to the published layout.
     *
     * MessageV2 header: version(4) sourceDomain(4) destinationDomain(4)
     * nonce(32) sender(32) recipient(32) destinationCaller(32)
     * minFinality(4) finalityExecuted(4) = 148 bytes.
     *
     * BurnMessageV2 body: version(4) burnToken(32) mintRecipient(32)
     * amount(32) messageSender(32) maxFee(32) feeExecuted(32)
     * expirationBlock(32) then hookData.
     */
    function _encode(
        uint32 sourceDomain,
        bytes32 nonce,
        address recipient,
        address destinationCaller,
        address mintRecipient,
        uint256 amount,
        address messageSender,
        uint256 feeExecuted,
        bytes memory hookData
    ) internal pure returns (bytes memory) {
        bytes memory header = abi.encodePacked(
            uint32(1),
            sourceDomain,
            uint32(0),
            nonce,
            bytes32(0),
            bytes32(uint256(uint160(recipient))),
            bytes32(uint256(uint160(destinationCaller))),
            uint32(2000),
            uint32(2000)
        );

        bytes memory body = abi.encodePacked(
            uint32(1),
            bytes32(uint256(uint160(address(0)))),
            bytes32(uint256(uint160(mintRecipient))),
            amount,
            bytes32(uint256(uint160(messageSender))),
            uint256(0),
            feeExecuted,
            uint256(0),
            hookData
        );

        return abi.encodePacked(header, body);
    }

    function _validMessage(uint256 amount, uint256 fee) internal view returns (bytes memory) {
        return _encode(
            6,
            bytes32(uint256(0xC0FFEE)),
            TOKEN_MESSENGER,
            address(helper),
            address(helper),
            amount,
            WALLET,
            fee,
            bytes(LABEL)
        );
    }

    /*//////////////////////////////////////////////////////////////
                            HAPPY PATH
    //////////////////////////////////////////////////////////////*/

    function test_claimsAndRenews() public {
        bytes memory m = _validMessage(27_110_000, 0);

        vm.prank(EXECUTOR);
        helper.completeCCTP(m, hex"1234");

        assertGt(renewer.lastDuration(), 0, "no renewal happened");
        assertEq(usdc.balanceOf(EXECUTOR), helper.GAS_ALLOWANCE(), "executor unpaid");
    }

    /// @dev Whoever submits the claim is paid, not the source wallet.
    function test_submitterIsPaidNotTheWallet() public {
        bytes memory m = _validMessage(27_110_000, 0);

        vm.prank(EXECUTOR);
        helper.completeCCTP(m, hex"1234");

        assertEq(usdc.balanceOf(WALLET), 0, "the deposit wallet was paid its own money back");
    }

    /// @dev Only `burn.amount - burn.feeExecuted` may be spent.
    function test_feeIsSubtractedFromTheSpendableAmount() public {
        uint256 fee = 1_000_000;
        bytes memory withFee = _validMessage(27_110_000 + fee, fee);

        vm.prank(EXECUTOR);
        helper.completeCCTP(withFee, hex"1234");

        uint64 durationWithFee = renewer.lastDuration();

        (uint64 expected,) = helper.quote(LABEL, 27_110_000 - helper.GAS_ALLOWANCE());
        assertEq(durationWithFee, expected, "the CCTP fee was not deducted");
    }

    /*//////////////////////////////////////////////////////////////
                            ROUTE CHECKS
    //////////////////////////////////////////////////////////////*/

    function test_rejectsMessageNotAddressedToTokenMessenger() public {
        bytes memory m = _encode(
            6, bytes32(0), address(0xBAD), address(helper), address(helper), 27_110_000, WALLET, 0, bytes(LABEL)
        );

        vm.expectRevert(NamepassL1Gateway.InvalidCCTPMessage.selector);
        helper.completeCCTP(m, hex"1234");
    }

    function test_rejectsForeignDestinationCaller() public {
        bytes memory m = _encode(
            6, bytes32(0), TOKEN_MESSENGER, address(0xBAD), address(helper), 27_110_000, WALLET, 0, bytes(LABEL)
        );

        vm.expectRevert(NamepassL1Gateway.InvalidCCTPMessage.selector);
        helper.completeCCTP(m, hex"1234");
    }

    function test_rejectsForeignMintRecipient() public {
        bytes memory m = _encode(
            6, bytes32(0), TOKEN_MESSENGER, address(helper), address(0xBAD), 27_110_000, WALLET, 0, bytes(LABEL)
        );

        vm.expectRevert(NamepassL1Gateway.InvalidCCTPMessage.selector);
        helper.completeCCTP(m, hex"1234");
    }

    function test_rejectsTruncatedMessage() public {
        vm.expectRevert(NamepassL1Gateway.InvalidCCTPMessage.selector);
        helper.completeCCTP(new bytes(375), hex"1234");
    }

    function test_rejectsFeeExceedingBurnAmount() public {
        bytes memory m = _validMessage(1_000_000, 2_000_000);

        vm.expectRevert(NamepassL1Gateway.InvalidCCTPMessage.selector);
        helper.completeCCTP(m, hex"1234");
    }

    /*//////////////////////////////////////////////////////////////
                        LABEL / WALLET BINDING
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev The label in the hook is bound to the wallet that burned.
     *
     * This is what makes `completeCCTP` safe to leave permissionless:
     * rebinding a payment to another name would need a keccak preimage
     * against `predictWallet`.
     */
    function test_rejectsHookLabelThatDoesNotMatchTheBurner() public {
        bytes memory m = _encode(
            6,
            bytes32(0),
            TOKEN_MESSENGER,
            address(helper),
            address(helper),
            27_110_000,
            address(0xBAD),
            0,
            bytes(LABEL)
        );

        vm.expectRevert(NamepassL1Gateway.InvalidWallet.selector);
        helper.completeCCTP(m, hex"1234");
    }

    function test_rejectsSubstitutedLabel() public {
        bytes memory m = _encode(
            6,
            bytes32(0),
            TOKEN_MESSENGER,
            address(helper),
            address(helper),
            27_110_000,
            WALLET,
            0,
            bytes("someoneelse")
        );

        vm.expectRevert(NamepassL1Gateway.InvalidWallet.selector);
        helper.completeCCTP(m, hex"1234");
    }

    /*//////////////////////////////////////////////////////////////
                          THE MINT ASSERTION
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev A mint that disagrees with the authenticated burn is
     * refused, so pre-existing dust can never be counted into a flow.
     */
    function test_rejectsMintSmallerThanTheAuthenticatedAmount() public {
        transmitter.setMint(address(helper), 1_000_000);

        bytes memory m = _validMessage(27_110_000, 0);

        vm.expectRevert(NamepassL1Gateway.UnexpectedMintAmount.selector);
        helper.completeCCTP(m, hex"1234");
    }

    /// @dev Dust already in the helper must not be spendable by a flow.
    function test_existingDustIsNotCountedIntoTheFlow() public {
        usdc.mint(address(helper), 5_000_000);

        bytes memory m = _validMessage(27_110_000, 0);

        vm.prank(EXECUTOR);
        helper.completeCCTP(m, hex"1234");

        (uint64 expected,) = helper.quote(LABEL, 27_110_000 - helper.GAS_ALLOWANCE());
        assertEq(renewer.lastDuration(), expected, "pre-existing balance leaked into the flow");
    }

    function test_revertsWhenReceiveMessageFails() public {
        transmitter.setSucceed(false);

        bytes memory m = _validMessage(27_110_000, 0);

        vm.expectRevert(NamepassL1Gateway.CCTPReceiveFailed.selector);
        helper.completeCCTP(m, hex"1234");
    }

    function test_messageUsesReplacementHelperAndCannotReplay() public {
        address[] memory actors = new address[](1);
        actors[0] = address(this);
        TimelockController timelock = new TimelockController(1 days, actors, actors, address(0));
        vm.prank(GOVERNANCE);
        pointer.transferGovernance(address(timelock));
        bytes memory accept = abi.encodeCall(pointer.acceptGovernance, ());
        timelock.schedule(address(pointer), 0, accept, bytes32(0), bytes32(0), 1 days);
        vm.warp(block.timestamp + 1 days);
        timelock.execute(address(pointer), 0, accept, bytes32(0), bytes32(0));
        // The message records the permanent gateway while adapter A is active.
        bytes memory message = _validMessage(27_110_000, 0);
        MockRenewer nextRenewer = new MockRenewer(renewer.rentPriceOracle(), address(0xB2));
        ENSV2RenewalHelper next = new ENSV2RenewalHelper(
            address(helper), address(factory), address(usdc), address(nextRenewer), address(0), REFERRER
        );
        bytes memory update = abi.encodeCall(pointer.setHelper, (address(next)));
        timelock.schedule(address(pointer), 0, update, bytes32(0), bytes32(0), 1 days);
        vm.warp(block.timestamp + 1 days);
        timelock.execute(address(pointer), 0, update, bytes32(0), bytes32(0));
        vm.prank(EXECUTOR);
        helper.completeCCTP(message, hex"1234");
        assertEq(renewer.lastDuration(), 0);
        assertGt(nextRenewer.lastDuration(), 0);
        assertEq(usdc.allowance(address(helper), address(adapter)), 0);
        assertEq(usdc.allowance(address(helper), address(next)), 0);
        vm.expectRevert(bytes("nonce used"));
        helper.completeCCTP(message, hex"1234");
    }

    function test_failedClaimRollsBackMintAndNonceThenRetriesSameMessage() public {
        bytes memory message = _validMessage(27_110_000, 0);
        renewer.setRenewable(false);
        vm.expectRevert(ENSV2RenewalHelper.NameNotRenewable.selector);
        helper.completeCCTP(message, hex"1234");
        assertFalse(transmitter.usedNonces(bytes32(uint256(0xC0FFEE))));
        assertEq(usdc.balanceOf(address(helper)), 0);
        assertEq(usdc.balanceOf(address(adapter)), 0);
        assertEq(usdc.allowance(address(helper), address(adapter)), 0);
        renewer.setRenewable(true);
        helper.completeCCTP(message, hex"1234");
        assertTrue(transmitter.usedNonces(bytes32(uint256(0xC0FFEE))));
    }

    function test_rejectsWrongVersionsAndDomain() public {
        bytes memory message = _validMessage(27_110_000, 0);
        message[3] = 0x02;
        vm.expectRevert(NamepassL1Gateway.InvalidCCTPMessage.selector);
        helper.completeCCTP(message, hex"1234");
        message[3] = 0x01;
        message[151] = 0x02;
        vm.expectRevert(NamepassL1Gateway.InvalidCCTPMessage.selector);
        helper.completeCCTP(message, hex"1234");
        message[151] = 0x01;
        message[11] = 0x06;
        vm.expectRevert(NamepassL1Gateway.InvalidCCTPMessage.selector);
        helper.completeCCTP(message, hex"1234");
    }

    function test_rejectsNonCanonicalSenderAndEmptyLabel() public {
        bytes memory message = _validMessage(27_110_000, 0);
        message[248] = 0x01;
        vm.expectRevert(NamepassL1Gateway.InvalidCCTPMessage.selector);
        helper.completeCCTP(message, hex"1234");
        message =
            _encode(6, bytes32(0), TOKEN_MESSENGER, address(helper), address(helper), 27_110_000, WALLET, 0, bytes(""));
        vm.expectRevert(NamepassL1Gateway.InvalidLabel.selector);
        helper.completeCCTP(message, hex"1234");
    }
}
