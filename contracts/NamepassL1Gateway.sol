// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {INamepassRenewalHelper} from "./interfaces/INamepassRenewalHelper.sol";
import {RenewalHelperPointer} from "./RenewalHelperPointer.sol";

interface INamepassFactory {
    function predictWallet(string calldata label) external view returns (address);
}

interface IMessageTransmitterV2 {
    function receiveMessage(bytes calldata message, bytes calldata attestation) external returns (bool);
}

/// @notice Permanent endpoint for wallet payments and CCTP claims.
/// @dev A replacement ENS helper cannot change the destination recorded in a burn.
contract NamepassL1Gateway is ReentrancyGuard {
    uint256 public constant GAS_ALLOWANCE = 100_000;
    address public immutable factory;
    address public immutable paymentToken;
    RenewalHelperPointer public immutable pointer;
    IERC20 private immutable USDC;
    IMessageTransmitterV2 private immutable MESSAGE_TRANSMITTER;
    address private immutable TOKEN_MESSENGER;
    address public immutable residueRecipient;
    uint256 public earnedResidue;

    error InvalidAddress();
    error InvalidLabel();
    error InvalidWallet();
    error InvalidCCTPMessage();
    error CCTPReceiveFailed();
    error UnexpectedMintAmount();
    error InsufficientAmount();
    error ApprovalFailed();
    error TransferFailed();
    error InvalidSettlement();
    error NoActiveHelper();

    event CCTPClaimed(
        bytes32 indexed nonce,
        address indexed wallet,
        uint32 sourceDomain,
        uint256 burnAmount,
        uint256 feeExecuted,
        uint256 mintedAmount
    );
    event Renewed(
        bytes32 indexed labelHash,
        address indexed wallet,
        address indexed executor,
        string label,
        uint64 duration,
        uint256 amountReceived,
        uint256 gasAllowance,
        uint256 amountApplied,
        uint256 remainder,
        bool fromCCTP
    );
    event HelperUsed(address indexed helper, bytes32 indexed labelHash, address indexed wallet);
    event DustWithdrawn(address indexed to, uint256 amount);

    constructor(
        address factory_,
        address usdc_,
        address transmitter_,
        address messenger_,
        address pointer_,
        address residueRecipient_
    ) {
        if (
            (block.chainid != 1 && block.chainid != 11155111) || factory_.code.length == 0 || usdc_.code.length == 0
                || transmitter_.code.length == 0 || messenger_.code.length == 0 || pointer_.code.length == 0
                || residueRecipient_ == address(0) || residueRecipient_ == address(this)
        ) {
            revert InvalidAddress();
        }
        factory = factory_;
        paymentToken = usdc_;
        USDC = IERC20(usdc_);
        MESSAGE_TRANSMITTER = IMessageTransmitterV2(transmitter_);
        TOKEN_MESSENGER = messenger_;
        pointer = RenewalHelperPointer(pointer_);
        if (pointer.factory() != factory_ || pointer.paymentToken() != usdc_) revert InvalidAddress();
        residueRecipient = residueRecipient_;
    }

    /// @notice Quote a budget after the fixed executor allowance has been removed.
    function quote(string calldata label, uint256 budget) external view returns (uint64 duration, uint256 needed) {
        return INamepassRenewalHelper(_activeHelper()).quote(label, budget);
    }

    /// @notice Anyone can send earned rounding residue to the fixed recipient.
    /// @dev Direct token donations do not become withdrawable residue.
    function withdrawDust() external nonReentrant {
        uint256 amount = earnedResidue;
        if (amount == 0) revert InsufficientAmount();
        earnedResidue = 0;
        if (!USDC.transfer(residueRecipient, amount)) revert TransferFailed();
        emit DustWithdrawn(residueRecipient, amount);
    }

    function _activeHelper() private view returns (address helper) {
        helper = pointer.currentHelper();
        if (helper == address(0) || pointer.gateway() != address(this)) revert NoActiveHelper();
    }

    function _validateLabel(string memory label) private pure {
        bytes memory raw = bytes(label);
        if (raw.length == 0 || raw.length > 255) revert InvalidLabel();
        for (uint256 i; i < raw.length; ++i) {
            if (raw[i] == 0x2e) revert InvalidLabel();
        }
    }

    uint256 private constant MESSAGE_SOURCE_DOMAIN_OFFSET = 4;

    uint256 private constant MESSAGE_NONCE_OFFSET = 12;

    uint256 private constant MESSAGE_RECIPIENT_OFFSET = 76;

    uint256 private constant MESSAGE_DESTINATION_CALLER_OFFSET = 108;

    uint256 private constant BURN_MINT_RECIPIENT_OFFSET = 184;

    uint256 private constant BURN_AMOUNT_OFFSET = 216;

    uint256 private constant BURN_MESSAGE_SENDER_OFFSET = 248;

    uint256 private constant BURN_FEE_EXECUTED_OFFSET = 312;

    uint256 private constant BURN_HOOK_DATA_OFFSET = 376;

    function renewFromWallet(string calldata label, uint256 amount, address executor) external nonReentrant {
        _validateLabel(label);
        if (msg.sender != INamepassFactory(factory).predictWallet(label)) {
            revert InvalidWallet();
        }

        if (executor == address(0)) {
            revert InvalidAddress();
        }

        address selected = _activeHelper();
        uint256 beforeBalance = USDC.balanceOf(address(this));

        if (!USDC.transferFrom(msg.sender, address(this), amount)) {
            revert TransferFailed();
        }

        /*
         * A fee-on-transfer or rebasing USDC would break the
         * accounting below, so the delta is checked rather than
         * assumed.
         */
        if (USDC.balanceOf(address(this)) != beforeBalance + amount) {
            revert UnexpectedMintAmount();
        }

        _renew(label, amount, msg.sender, executor, false, selected);
    }

    /*//////////////////////////////////////////////////////////////
                            CCTP PATH
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Receives an attested CCTP V2 burn and renews the ENS
     * label encoded in its hook data.
     *
     * @dev Accounting is based only on:
     *
     *     burn.amount - burn.feeExecuted
     *
     * from this authenticated CCTP message.
     *
     * The gateway's existing USDC balance is never used to determine
     * how much this renewal may spend.
     *
     * Permissionless by design: the label is bound to the wallet
     * that burned, so a caller cannot redirect the payment. Whoever
     * submits it is paid `GAS_ALLOWANCE`, which is what makes the
     * final step worth somebody's gas.
     */
    function completeCCTP(bytes calldata message, bytes calldata attestation) external nonReentrant {
        if (message.length < BURN_HOOK_DATA_OFFSET) {
            revert InvalidCCTPMessage();
        }

        _validateRoute(message);

        /*
         * Factory sends raw bytes(label), not abi.encode(label).
         */
        bytes calldata hookData = message[BURN_HOOK_DATA_OFFSET:];

        string memory label = string(hookData);
        _validateLabel(label);

        /*
         * BurnMessageV2.messageSender is the universal source
         * wallet that called TokenMessengerV2.
         */
        address sourceWallet = address(uint160(uint256(_readBytes32(message, BURN_MESSAGE_SENDER_OFFSET))));

        if (_readBytes32(message, BURN_MESSAGE_SENDER_OFFSET) != _addressToBytes32(sourceWallet)) {
            revert InvalidCCTPMessage();
        }
        if (sourceWallet != INamepassFactory(factory).predictWallet(label)) {
            revert InvalidWallet();
        }

        address selected = _activeHelper();
        _renew(label, _claim(message, attestation, sourceWallet), sourceWallet, msg.sender, true, selected);
    }

    /**
     * @dev Requires a genuine Namepass-shaped CCTP route:
     *
     * - destination CCTP recipient is TokenMessengerV2;
     * - this gateway is destinationCaller;
     * - this gateway is mintRecipient.
     *
     * Split out of `completeCCTP` for stack depth, not for reuse.
     * Keeping it inline pushed that function over the limit under
     * the pinned optimizer settings, and `via_ir` is not an option
     * here — it changes the bytecode, and `foundry.toml` is pinned
     * because the factory's creation-code hash decides every deposit
     * address.
     */
    function _validateRoute(bytes calldata message) private view {
        if (
            _readUint32(message, 0) != 1 || _readUint32(message, 148) != 1 || _readUint32(message, 8) != 0
                || _readUint32(message, 4) == 0
        ) revert InvalidCCTPMessage();
        bytes32 self = _addressToBytes32(address(this));

        if (
            _readBytes32(message, MESSAGE_RECIPIENT_OFFSET) != _addressToBytes32(TOKEN_MESSENGER)
                || _readBytes32(message, MESSAGE_DESTINATION_CALLER_OFFSET) != self
                || _readBytes32(message, BURN_MINT_RECIPIENT_OFFSET) != self
        ) {
            revert InvalidCCTPMessage();
        }
    }

    /**
     * @dev Claims the message and returns the amount Circle actually
     * minted, which is the only figure the renewal is allowed to
     * spend against.
     *
     * Also split for stack depth — see `_validateRoute`.
     */
    function _claim(bytes calldata message, bytes calldata attestation, address wallet)
        private
        returns (uint256 mintedAmount)
    {
        uint256 burnAmount = uint256(_readBytes32(message, BURN_AMOUNT_OFFSET));

        uint256 feeExecuted = uint256(_readBytes32(message, BURN_FEE_EXECUTED_OFFSET));

        if (feeExecuted > burnAmount) {
            revert InvalidCCTPMessage();
        }

        /*
         * Exact amount Circle is instructed to mint to this gateway.
         */
        unchecked {
            mintedAmount = burnAmount - feeExecuted;
        }

        if (mintedAmount == 0) {
            revert InsufficientAmount();
        }

        /*
         * This balance read is ONLY an assertion around the mint.
         *
         * It is not used as the renewal amount.
         *
         * Existing dust or funds belonging to another flow are
         * therefore never included in this flow's accounting.
         */
        uint256 beforeBalance = USDC.balanceOf(address(this));

        if (!MESSAGE_TRANSMITTER.receiveMessage(message, attestation)) {
            revert CCTPReceiveFailed();
        }

        /*
         * Verify Circle actually minted exactly the authenticated
         * amount before permitting the renewal.
         */
        if (USDC.balanceOf(address(this)) != beforeBalance + mintedAmount) {
            revert UnexpectedMintAmount();
        }

        emit CCTPClaimed(
            _readBytes32(message, MESSAGE_NONCE_OFFSET),
            wallet,
            _readUint32(message, MESSAGE_SOURCE_DOMAIN_OFFSET),
            burnAmount,
            feeExecuted,
            mintedAmount
        );
    }

    function _renew(
        string memory label,
        uint256 amount,
        address wallet,
        address executor,
        bool fromCCTP,
        address selected
    ) private {
        if (amount <= GAS_ALLOWANCE) revert InsufficientAmount();
        uint256 budget = amount - GAS_ALLOWANCE;
        uint256 beforeBalance = USDC.balanceOf(address(this));
        if (!USDC.approve(selected, budget)) revert ApprovalFailed();
        (uint64 duration, uint256 charged) = INamepassRenewalHelper(selected).execute(label, budget);
        if (!USDC.approve(selected, 0)) revert ApprovalFailed();
        if (
            duration == 0 || charged == 0 || charged > budget
                || USDC.balanceOf(address(this)) != beforeBalance - charged
        ) revert InvalidSettlement();
        earnedResidue += budget - charged;
        if (!USDC.transfer(executor, GAS_ALLOWANCE)) revert TransferFailed();
        emit HelperUsed(selected, keccak256(bytes(label)), wallet);
        emit Renewed(
            keccak256(bytes(label)),
            wallet,
            executor,
            label,
            duration,
            amount,
            GAS_ALLOWANCE,
            charged,
            budget - charged,
            fromCCTP
        );
    }

    function _readBytes32(bytes calldata data, uint256 offset) private pure returns (bytes32 value) {
        assembly ("memory-safe") {
            value := calldataload(add(data.offset, offset))
        }
    }

    function _readUint32(bytes calldata data, uint256 offset) private pure returns (uint32 value) {
        assembly ("memory-safe") {
            value := shr(224, calldataload(add(data.offset, offset)))
        }
    }

    function _addressToBytes32(address value) private pure returns (bytes32) {
        return bytes32(uint256(uint160(value)));
    }
}
