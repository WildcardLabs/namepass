// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/*//////////////////////////////////////////////////////////////
                            INTERFACES
//////////////////////////////////////////////////////////////*/

interface IERC20 {
    function balanceOf(
        address account
    ) external view returns (uint256);

    function approve(
        address spender,
        uint256 amount
    ) external returns (bool);

    function transfer(
        address to,
        uint256 amount
    ) external returns (bool);

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external returns (bool);
}

interface IENSV2PriceOracle {
    struct DiscountPoint {
        uint64 duration;
        uint128 numer;
    }

    function DISCOUNT_DENOMINATOR()
        external
        view
        returns (uint128);

    function getBaseRates()
        external
        view
        returns (uint256[] memory);

    function getDiscountPoints()
        external
        view
        returns (DiscountPoint[] memory);

    /**
     * @dev Two values, not one. ENS converts a standard-unit price
     * into payment-token units as `ceil(value * numer / denom)`.
     */
    function getPaymentTokenRatio(
        IERC20 paymentToken
    ) external view returns (uint128 numer, uint128 denom);
}

/**
 * @dev ENS's `IETHRenewer`. Both `ETHRegistrar` and `ETHRenewerV1`
 * implement it through `AbstractETHRegistrar`, which is what lets one
 * code path drive either.
 */
interface IETHRenewer {
    /**
     * @dev Whether *this* renewer is the one that can renew `label`.
     * The two implementations have deliberately disjoint predicates,
     * so at most one answers true.
     */
    function isRenewable(
        string calldata label
    ) external view returns (bool);

    function renew(
        string calldata label,
        uint64 duration,
        IERC20 paymentToken,
        bytes32 referrer
    ) external;

    /**
     * @dev The oracle this renewer actually prices with. Read on
     * every quote rather than stored here, so the two can never
     * disagree.
     */
    function rentPriceOracle()
        external
        view
        returns (IENSV2PriceOracle);

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
    function getRenewPrice(
        string calldata label,
        uint64 duration,
        IERC20 paymentToken
    ) external view returns (uint256);
}

interface INamepassFactory {
    function predictWallet(
        string calldata label
    ) external view returns (address);
}

interface IMessageTransmitterV2 {
    function receiveMessage(
        bytes calldata message,
        bytes calldata attestation
    ) external returns (bool success);
}

/*//////////////////////////////////////////////////////////////
                      ENS V2 RENEWAL HELPER
//////////////////////////////////////////////////////////////*/

contract ENSV2RenewalHelper {
    /*//////////////////////////////////////////////////////////////
                              CONSTANTS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Flat fee paid to whoever submits the final Ethereum
     * transaction, taken off every payment before it is priced.
     *
     * $0.10 in USDC base units. Must stay equal to `GAS_ALLOWANCE`
     * in `src/lib/fees.ts` — the UI quotes send amounts that carry
     * it and solves durations from `budget - allowance`, so the two
     * numbers are one number.
     *
     * @dev Deliberately a constant rather than an owner setting.
     * Every payment passes through here, so a mutable fee would be
     * an owner dial on user funds — the same objection that removed
     * the factory's sweep. The cost is that it can never be changed:
     * `NamepassFactory.initialize` freezes `_l1Helper` on first set,
     * so this contract is not replaceable either. If mainnet gas
     * makes $0.10 wrong, that is a redeploy of the whole system, not
     * a setter.
     */
    uint256 public constant GAS_ALLOWANCE = 100_000;

    /**
     * @dev Longest label ENS will price, in raw UTF-8 bytes.
     *
     * ENS's own bound, from `StandardRentPriceOracle.getBasePrice`.
     * Matches `NamepassFactory.MAX_LABEL_BYTES`.
     */
    uint256 private constant MAX_LABEL_BYTES = 255;

    /*//////////////////////////////////////////////////////////////
                        CCTP V2 MESSAGE OFFSETS
    //////////////////////////////////////////////////////////////*/

    /*
     * Top-level MessageV2:
     *
     * sourceDomain       @ 4
     * nonce              @ 12
     * recipient          @ 76
     * destinationCaller  @ 108
     * messageBody        @ 148
     *
     * BurnMessageV2 starts at 148:
     *
     * mintRecipient  148 + 36  = 184
     * amount         148 + 68  = 216
     * messageSender  148 + 100 = 248
     * feeExecuted    148 + 164 = 312
     * hookData       148 + 228 = 376
     */

    uint256 private constant MESSAGE_SOURCE_DOMAIN_OFFSET = 4;

    uint256 private constant MESSAGE_NONCE_OFFSET = 12;

    uint256 private constant MESSAGE_RECIPIENT_OFFSET = 76;

    uint256 private constant MESSAGE_DESTINATION_CALLER_OFFSET = 108;

    uint256 private constant BURN_MINT_RECIPIENT_OFFSET = 184;

    uint256 private constant BURN_AMOUNT_OFFSET = 216;

    uint256 private constant BURN_MESSAGE_SENDER_OFFSET = 248;

    uint256 private constant BURN_FEE_EXECUTED_OFFSET = 312;

    uint256 private constant BURN_HOOK_DATA_OFFSET = 376;

    /*//////////////////////////////////////////////////////////////
                               STORAGE
    //////////////////////////////////////////////////////////////*/

    /*
     * Two-step, mirroring NamepassFactory.
     *
     * The owner's only power is `withdrawDust`. Nothing it can do
     * touches pricing, ENS's renewers, their oracles, or a payment
     * in flight — those are immutable, ENS-governed, or read from
     * the selected renewer.
     */
    address private _owner;

    address private _pendingOwner;

    /*
     * Public because NamepassFactory.initialize() validates that the
     * helper points back to the correct factory.
     */
    address public immutable factory;

    IERC20 private immutable USDC;

    IMessageTransmitterV2 private immutable MESSAGE_TRANSMITTER;

    /*
     * TokenMessengerV2 on the chain this helper is deployed to.
     *
     * Used to verify that a CCTP message is actually addressed to
     * Circle's TokenMessenger rather than an arbitrary recipient
     * carrying fake BurnMessage-shaped bytes.
     */
    address private immutable TOKEN_MESSENGER;

    /**
     * @notice The address ENS governance *executes* from — the only
     * address that can move this contract to new ENS renewers.
     *
     * @dev **This is the DAO Timelock, not the Governor.** ENS
     * proposals are voted on at the Governor (`governor.ensdao.eth`)
     * but queued and executed through the Timelock
     * (`wallet.ensdao.eth`), which is a separate mainnet address. The
     * `msg.sender` this contract sees when an executable proposal
     * calls `setRenewers` is the Timelock. Passing the Governor
     * would compile, deploy, and leave the renewers permanently
     * unchangeable — the exact failure this parameter exists to
     * prevent, discovered only when ENS first tried to migrate.
     * Verify the address against ENS's current deployment before
     * deploying; the two have been renamed before.
     *
     * Deliberately not the Namepass owner. A registrar migration is
     * an ENS event, so the authority to follow it belongs to ENS:
     * the pointer update can ride in the same proposal that ships
     * the new registrar, and Namepass needs no key, no notice and no
     * action.
     *
     * The alternative was an immutable registrar, which is safe but
     * terminal — `NamepassFactory.initialize` freezes `_l1Helper` on
     * first set, so a new helper means a new factory and therefore
     * new deposit addresses for every name ever published. Handing
     * the one upgrade path to ENS avoids that without giving the
     * Namepass owner any pricing power.
     *
     * Not immutable, because ENS's own governance can migrate. If
     * this were fixed and ENS retired the Timelock it names, the
     * successor could never update the renewers and the pointers
     * would freeze — the same trap as an immutable registrar, one
     * level up. `setGovernanceExecutor` lets ENS carry the authority
     * across. Still no Namepass key involved: the only address that
     * can change it is the one that currently holds it.
     */
    address public ensGovernanceExecutor;

    /**
     * @notice Tag credited on every renewal under ENS's referrer
     * programme.
     *
     * @dev Owner-settable, and safely so. On the renewal path this
     * value reaches exactly one place — the `referrer` field of ENS's
     * `NameRenewed` event. It does not enter the price, the
     * beneficiary, or the duration, all of which the registrar
     * decides from its own oracle and immutables. Changing it can
     * therefore move attribution and nothing else, which is a
     * different kind of thing from `GAS_ALLOWANCE`, where a setter
     * would be an owner dial on money taken from every payment.
     *
     * `bytes32` rather than an address because that is ENS's type and
     * the field is opaque to the renewal path. Constraining it to
     * address shape would have been a typo guard, and mutability is a
     * better one: a wrong value here is now a transaction to fix
     * rather than a redeployment of a contract that cannot be
     * replaced. An address goes in as
     * `bytes32(uint256(uint160(addr)))`.
     *
     * Zero is allowed and means unattributed.
     */
    bytes32 public referrer;

    /**
     * @notice ENS's `ETHRegistrar` — migrated and native v2 names.
     *
     * @dev Renews names that are `REGISTERED`, or in grace with a
     * `latestOwner`.
     *
     * Changeable only by `ensGovernanceExecutor`. No Namepass key can
     * touch it.
     */
    IETHRenewer private ethRegistrar;

    /**
     * @notice ENS's `ETHRenewerV1` — premigrated v1 reservations.
     *
     * @dev During the v1 to v2 migration there is no single canonical
     * renewer. A premigrated name sits in v2 as `RESERVED` with no
     * owner and is renewable only through `ETHRenewerV1`, which also
     * renews the old v1 registrar; once the owner migrates it becomes
     * `REGISTERED` and only `ETHRegistrar` will take it. The two
     * predicates are disjoint by construction, and both populations
     * exist simultaneously for the length of the migration — so a
     * helper holding one address would silently fail for half of ENS,
     * and switching the pointer would just swap which half.
     *
     * May be the zero address, which means "not deployed, or
     * decommissioned once migration completes" and simply removes it
     * from selection.
     */
    IETHRenewer private ethRenewerV1;

    /*//////////////////////////////////////////////////////////////
                                ERRORS
    //////////////////////////////////////////////////////////////*/

    error NotOwner();

    error NotPendingOwner();

    error NotGovernance();

    error InvalidAddress();

    error InvalidLabel();

    error InvalidOracleConfig();

    error InvalidWallet();

    error InvalidCCTPMessage();

    error CCTPReceiveFailed();

    error UnexpectedMintAmount();

    error InsufficientAmount();

    error ApprovalFailed();

    error TransferFailed();

    error DurationOverflow();

    error UnexpectedRenewalPrice();

    error NameNotRenewable();

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event ReferrerUpdated(
        bytes32 indexed referrer
    );

    event GovernanceExecutorUpdated(
        address indexed previousExecutor,
        address indexed newExecutor
    );

    event RenewersUpdated(
        address indexed ethRegistrar,
        address indexed ethRenewerV1
    );

    event OwnershipTransferStarted(
        address indexed previousOwner,
        address indexed newOwner
    );

    event OwnershipTransferred(
        address indexed previousOwner,
        address indexed newOwner
    );

    /**
     * @notice A CCTP message was claimed on Ethereum.
     *
     * @dev `nonce` and `sourceDomain` are what `flows.cctp_nonce`
     * and `flows.origin_chain_id` are reconciled against.
     *
     * Do not build monitoring on the absence of a matching
     * `Renewed`. The claim and the renewal are one transaction, so a
     * failing renewal reverts this log with it — on chain you see
     * both events or neither, never this one alone. What a reverted
     * claim looks like is an attested message that stays unclaimed,
     * which is observable from Circle rather than from here.
     */
    event CCTPClaimed(
        bytes32 indexed nonce,
        address indexed wallet,
        uint32 sourceDomain,
        uint256 burnAmount,
        uint256 feeExecuted,
        uint256 mintedAmount
    );

    /**
     * @notice A renewal settled on Ethereum.
     *
     * @dev The three amounts `flows` tracks are all here and are
     * deliberately not collapsed: `amountReceived` is what arrived,
     * `gasAllowance` is what paid the submitter, `amountApplied` is
     * what the registrar actually charged. `remainder` is the
     * sub-second rounding residue that stays in this contract.
     *
     * `label` is unindexed so an indexer can read it; `labelHash` is
     * indexed so it can be filtered on. Indexing a string would only
     * store its hash and lose the readable value.
     *
     * `fromCCTP` distinguishes a bridged payment from an
     * Ethereum-origin one, which is what decides whether the UI
     * labels the final step "Renewed" or "Minted and renewed".
     */
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

    /**
     * @notice Rounding residue swept by the owner.
     *
     * @dev Not a funder's pending balance — see the helper invariant
     * in `docs/ARCHITECTURE.md`. Renewals buy whole seconds, so a
     * few micro-units are left behind by every one of them.
     */
    event DustWithdrawn(
        address indexed to,
        uint256 amount
    );

    /*//////////////////////////////////////////////////////////////
                              MODIFIERS
    //////////////////////////////////////////////////////////////*/

    modifier onlyOwner() {
        if (msg.sender != _owner) {
            revert NotOwner();
        }

        _;
    }

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(
        address factory_,
        address usdc_,
        address messageTransmitter_,
        address tokenMessenger_,
        address ethRegistrar_,
        address ethRenewerV1_,
        address ensGovernanceExecutor_,
        bytes32 referrer_
    ) {
        if (
            factory_ == address(0) ||
            usdc_ == address(0) ||
            messageTransmitter_ == address(0) ||
            tokenMessenger_ == address(0) ||
            ethRegistrar_ == address(0) ||
            ensGovernanceExecutor_ == address(0)
        ) {
            revert InvalidAddress();
        }

        /*
         * These contracts must already exist.
         */
        if (
            factory_.code.length == 0 ||
            usdc_.code.length == 0 ||
            messageTransmitter_.code.length == 0 ||
            tokenMessenger_.code.length == 0 ||
            ethRegistrar_.code.length == 0
        ) {
            revert InvalidAddress();
        }

        _owner = msg.sender;

        factory = factory_;

        USDC =
            IERC20(usdc_);

        MESSAGE_TRANSMITTER =
            IMessageTransmitterV2(
                messageTransmitter_
            );

        TOKEN_MESSENGER =
            tokenMessenger_;

        ethRegistrar =
            IETHRenewer(
                ethRegistrar_
            );

        /*
         * Optional: zero means the migration renewer is not deployed
         * on this network, or is already retired.
         */
        if (ethRenewerV1_ != address(0)) {
            if (ethRenewerV1_.code.length == 0) {
                revert InvalidAddress();
            }

            ethRenewerV1 =
                IETHRenewer(
                    ethRenewerV1_
                );
        }

        ensGovernanceExecutor = ensGovernanceExecutor_;

        emit GovernanceExecutorUpdated(
            address(0),
            ensGovernanceExecutor_
        );

        referrer = referrer_;

        emit ReferrerUpdated(referrer_);

        emit RenewersUpdated(
            ethRegistrar_,
            ethRenewerV1_
        );

        emit OwnershipTransferred(
            address(0),
            msg.sender
        );

    }

    /*//////////////////////////////////////////////////////////////
                              OWNERSHIP
    //////////////////////////////////////////////////////////////*/

    function owner()
        external
        view
        returns (address)
    {
        return _owner;
    }

    function pendingOwner()
        external
        view
        returns (address)
    {
        return _pendingOwner;
    }

    /**
     * @notice Starts a two-step ownership transfer.
     *
     * @dev Two-step because a mistyped address here is unrecoverable
     * in a way it is not on most contracts: the factory freezes its
     * `_l1Helper` on first set, so this helper can never be replaced.
     */
    function transferOwnership(
        address newOwner
    )
        external
        onlyOwner
    {
        if (newOwner == address(0)) {
            revert InvalidAddress();
        }

        _pendingOwner = newOwner;

        emit OwnershipTransferStarted(
            _owner,
            newOwner
        );
    }

    /**
     * @notice Completes a transfer started by `transferOwnership`.
     */
    function acceptOwnership() external {
        if (msg.sender != _pendingOwner) {
            revert NotPendingOwner();
        }

        address previousOwner = _owner;

        _owner = msg.sender;

        delete _pendingOwner;

        emit OwnershipTransferred(
            previousOwner,
            msg.sender
        );
    }

    /*//////////////////////////////////////////////////////////////
                              ADMIN
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Hands the ENS-side authority to a successor executor.
     *
     * @dev Callable only by the current executor, so ENS can carry
     * this contract across its own governance migration inside the
     * proposal that performs it. Namepass has no part in it.
     *
     * **One-way and immediate.** The moment this returns, the old
     * address can do nothing here. ENS should point it at an
     * executor that is already live and already able to execute, not
     * at one still to be deployed — the handover cannot be verified
     * or undone from this side.
     */
    function setGovernanceExecutor(
        address newExecutor
    ) external {
        if (msg.sender != ensGovernanceExecutor) {
            revert NotGovernance();
        }

        if (newExecutor == address(0)) {
            revert InvalidAddress();
        }

        address previousExecutor =
            ensGovernanceExecutor;

        ensGovernanceExecutor = newExecutor;

        emit GovernanceExecutorUpdated(
            previousExecutor,
            newExecutor
        );
    }

    /**
     * @notice Points this contract at ENS's renewal contracts.
     *
     * @dev Callable only by `ensGovernanceExecutor` — the DAO
     * Timelock — so a migration can be executed as part of an ENS
     * proposal rather than requiring Namepass to react to one.
     *
     * Both are set together because the pair has to stay coherent:
     * replacing one alone is how a name ends up renewable by neither.
     * `ethRenewerV1_` may be zero, which retires the migration path
     * once no reservations remain.
     *
     * The oracles follow automatically — each is read from its own
     * renewer on every quote and never stored.
     */
    function setRenewers(
        address ethRegistrar_,
        address ethRenewerV1_
    ) external {
        if (msg.sender != ensGovernanceExecutor) {
            revert NotGovernance();
        }

        if (
            ethRegistrar_ == address(0) ||
            ethRegistrar_.code.length == 0
        ) {
            revert InvalidAddress();
        }

        if (
            ethRenewerV1_ != address(0) &&
            ethRenewerV1_.code.length == 0
        ) {
            revert InvalidAddress();
        }

        ethRegistrar =
            IETHRenewer(
                ethRegistrar_
            );

        ethRenewerV1 =
            IETHRenewer(
                ethRenewerV1_
            );

        emit RenewersUpdated(
            ethRegistrar_,
            ethRenewerV1_
        );
    }

    /**
     * @notice Sets the tag credited under ENS's referrer programme.
     *
     * @dev Owner rather than ENS governance: this is a Namepass
     * attribution, not an ENS contract pointer. It cannot affect what
     * anyone is charged or where a payment goes — see the note on
     * `referrer`.
     */
    function setReferrer(
        bytes32 referrer_
    )
        external
        onlyOwner
    {
        referrer = referrer_;

        emit ReferrerUpdated(referrer_);
    }

    /**
     * @notice Withdraws accumulated rounding residue.
     *
     * @dev Safe against taking a funder's money only because of the
     * invariant that this contract never holds a pending balance:
     * both entrypoints price and spend within the same transaction
     * that the funds arrive in, so anything at rest here is residue.
     * Breaking that invariant would turn this into a custody
     * function.
     */
    function withdrawDust(
        address to,
        uint256 amount
    )
        external
        onlyOwner
    {
        if (to == address(0)) {
            revert InvalidAddress();
        }

        if (amount == 0) {
            revert InsufficientAmount();
        }

        if (
            !USDC.transfer(
                to,
                amount
            )
        ) {
            revert TransferFailed();
        }

        emit DustWithdrawn(
            to,
            amount
        );
    }

    /*//////////////////////////////////////////////////////////////
                              QUOTE
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Returns the maximum whole-second renewal duration
     * purchasable with `usdcAvailable`.
     *
     * @dev `usdcAvailable` is the amount that reaches the registrar,
     * i.e. already net of `GAS_ALLOWANCE`. Callers quoting a *send*
     * amount must subtract the allowance first, exactly as
     * `Simulator.tsx` does — quoting a send amount here silently
     * overstates the duration by up to a discount tier.
     *
     * @param label Normalized ENS label without ".eth".
     * @param usdcAvailable USDC available in 6-decimal base units.
     *
     * @return duration Maximum renewal duration in seconds.
     * @return amountNeeded Exact USDC base units required by that
     * duration.
     */
    function quote(
        string calldata label,
        uint256 usdcAvailable
    )
        external
        view
        returns (
            uint64 duration,
            uint256 amountNeeded
        )
    {
        return _quote(
            _selectRenewer(label),
            label,
            usdcAvailable
        );
    }

    /*//////////////////////////////////////////////////////////////
                       DIRECT ETHEREUM PATH
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Pulls `amount` from the deterministic wallet belonging
     * to `label` and renews with it.
     *
     * @dev Only that wallet can call this entrypoint.
     *
     * The pull is deliberate. An earlier shape had the wallet push
     * the USDC and then pass the figure it had sent, which made this
     * contract's accounting a claim by its caller rather than
     * something it could check. Pulling makes the amount
     * self-evident and puts this path on the same footing as the
     * CCTP one, where the figure is authenticated by Circle.
     *
     * Existing USDC already held by this shared helper is ignored.
     *
     * @param executor Recipient of `GAS_ALLOWANCE`. Forwarded from
     * the original caller of `NamepassFactory.renew`, since
     * `msg.sender` here is the wallet rather than whoever paid for
     * the transaction.
     */
    function renewFromWallet(
        string calldata label,
        uint256 amount,
        address executor
    ) external {
        if (
            msg.sender !=
            INamepassFactory(factory)
                .predictWallet(label)
        ) {
            revert InvalidWallet();
        }

        if (executor == address(0)) {
            revert InvalidAddress();
        }

        uint256 beforeBalance =
            USDC.balanceOf(
                address(this)
            );

        if (
            !USDC.transferFrom(
                msg.sender,
                address(this),
                amount
            )
        ) {
            revert TransferFailed();
        }

        /*
         * A fee-on-transfer or rebasing USDC would break the
         * accounting below, so the delta is checked rather than
         * assumed.
         */
        if (
            USDC.balanceOf(
                address(this)
            ) !=
            beforeBalance + amount
        ) {
            revert UnexpectedMintAmount();
        }

        _renew(
            label,
            amount,
            msg.sender,
            executor,
            false
        );
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
     * The helper's existing USDC balance is never used to determine
     * how much this renewal may spend.
     *
     * Permissionless by design: the label is bound to the wallet
     * that burned, so a caller cannot redirect the payment. Whoever
     * submits it is paid `GAS_ALLOWANCE`, which is what makes the
     * final step worth somebody's gas.
     */
    function completeCCTP(
        bytes calldata message,
        bytes calldata attestation
    ) external {
        if (
            message.length <
            BURN_HOOK_DATA_OFFSET
        ) {
            revert InvalidCCTPMessage();
        }

        _validateRoute(message);

        /*
         * Factory sends raw bytes(label), not abi.encode(label).
         */
        bytes calldata hookData =
            message[
                BURN_HOOK_DATA_OFFSET:
            ];

        string memory label =
            string(hookData);

        /*
         * BurnMessageV2.messageSender is the deterministic source
         * wallet that called TokenMessengerV2.
         */
        address sourceWallet =
            address(
                uint160(
                    uint256(
                        _readBytes32(
                            message,
                            BURN_MESSAGE_SENDER_OFFSET
                        )
                    )
                )
            );

        if (
            sourceWallet !=
            INamepassFactory(factory)
                .predictWallet(label)
        ) {
            revert InvalidWallet();
        }

        _renew(
            label,
            _claim(
                message,
                attestation,
                sourceWallet
            ),
            sourceWallet,
            msg.sender,
            true
        );
    }

    /**
     * @dev Requires a genuine Namepass-shaped CCTP route:
     *
     * - destination CCTP recipient is TokenMessengerV2;
     * - this helper is destinationCaller;
     * - this helper is mintRecipient.
     *
     * Split out of `completeCCTP` for stack depth, not for reuse.
     * Keeping it inline pushed that function over the limit under
     * the pinned optimizer settings, and `via_ir` is not an option
     * here — it changes the bytecode, and `foundry.toml` is pinned
     * because the factory's creation-code hash decides every deposit
     * address.
     */
    function _validateRoute(
        bytes calldata message
    )
        private
        view
    {
        bytes32 self =
            _addressToBytes32(
                address(this)
            );

        if (
            _readBytes32(
                message,
                MESSAGE_RECIPIENT_OFFSET
            ) !=
            _addressToBytes32(
                TOKEN_MESSENGER
            ) ||
            _readBytes32(
                message,
                MESSAGE_DESTINATION_CALLER_OFFSET
            ) != self ||
            _readBytes32(
                message,
                BURN_MINT_RECIPIENT_OFFSET
            ) != self
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
    function _claim(
        bytes calldata message,
        bytes calldata attestation,
        address wallet
    )
        private
        returns (uint256 mintedAmount)
    {
        uint256 burnAmount =
            uint256(
                _readBytes32(
                    message,
                    BURN_AMOUNT_OFFSET
                )
            );

        uint256 feeExecuted =
            uint256(
                _readBytes32(
                    message,
                    BURN_FEE_EXECUTED_OFFSET
                )
            );

        if (feeExecuted > burnAmount) {
            revert InvalidCCTPMessage();
        }

        /*
         * Exact amount Circle is instructed to mint to this helper.
         */
        unchecked {
            mintedAmount =
                burnAmount -
                feeExecuted;
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
        uint256 beforeBalance =
            USDC.balanceOf(
                address(this)
            );

        if (
            !MESSAGE_TRANSMITTER
                .receiveMessage(
                    message,
                    attestation
                )
        ) {
            revert CCTPReceiveFailed();
        }

        /*
         * Verify Circle actually minted exactly the authenticated
         * amount before permitting the renewal.
         */
        if (
            USDC.balanceOf(
                address(this)
            ) !=
            beforeBalance +
            mintedAmount
        ) {
            revert UnexpectedMintAmount();
        }

        emit CCTPClaimed(
            _readBytes32(
                message,
                MESSAGE_NONCE_OFFSET
            ),
            wallet,
            _readUint32(
                message,
                MESSAGE_SOURCE_DOMAIN_OFFSET
            ),
            burnAmount,
            feeExecuted,
            mintedAmount
        );
    }

    /*//////////////////////////////////////////////////////////////
                       INTERNAL RENEWAL
    //////////////////////////////////////////////////////////////*/

    function _renew(
        string memory label,
        uint256 amount,
        address wallet,
        address executor,
        bool fromCCTP
    ) private {
        /*
         * The allowance comes off before pricing, so the duration
         * bought is the duration the sender was quoted.
         */
        if (amount <= GAS_ALLOWANCE) {
            revert InsufficientAmount();
        }

        uint256 spendable;

        unchecked {
            spendable = amount - GAS_ALLOWANCE;
        }

        IETHRenewer renewer_ =
            _selectRenewer(label);

        (
            uint64 duration,
            uint256 amountNeeded
        ) = _quote(
            renewer_,
            label,
            spendable
        );

        /*
         * If the payment cannot buy even one second, leave it in
         * place rather than attempting a zero-duration renewal.
         *
         * ENS's own floor is `MIN_RENEW_DURATION`, currently one
         * second, and it is enforced inside `getRenewPrice` — so the
         * assertion in `_settle` catches a raised floor without this
         * contract tracking it.
         */
        if (
            duration == 0 ||
            amountNeeded == 0 ||
            amountNeeded > spendable
        ) {
            revert InsufficientAmount();
        }

        uint256 charged =
            _settle(
                renewer_,
                label,
                duration,
                amountNeeded
            );

        if (
            !USDC.transfer(
                executor,
                GAS_ALLOWANCE
            )
        ) {
            revert TransferFailed();
        }

        /*
         * spendable - amountNeeded remains here.
         *
         * Since `duration` is the maximum whole number of seconds
         * purchasable by this specific payment, this is the
         * sub-second / token-rounding remainder.
         *
         * It is intentionally not refunded and is not included in
         * another flow's renewal amount. `withdrawDust` is how it
         * eventually leaves.
         */
        emit Renewed(
            keccak256(bytes(label)),
            wallet,
            executor,
            label,
            duration,
            amount,
            GAS_ALLOWANCE,
            charged,
            spendable - charged,
            fromCCTP
        );
    }

    /**
     * @dev Buys `duration` and returns what the registrar actually
     * took.
     *
     * Split from `_renew` for stack depth. Also the natural seam:
     * everything here is a conversation with the registrar, and
     * everything in `_renew` is Namepass accounting.
     */
    function _settle(
        IETHRenewer renewer_,
        string memory label,
        uint64 duration,
        uint256 amountNeeded
    )
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
        if (
            renewer_.getRenewPrice(
                label,
                duration,
                USDC
            ) != amountNeeded
        ) {
            revert UnexpectedRenewalPrice();
        }

        /*
         * Approve only what this specific renewal needs.
         */
        if (
            !USDC.approve(
                address(renewer_),
                amountNeeded
            )
        ) {
            revert ApprovalFailed();
        }

        uint256 beforeRenew =
            USDC.balanceOf(
                address(this)
            );

        renewer_.renew(
            label,
            duration,
            USDC,
            referrer
        );

        /*
         * What the registrar actually took, not what it was quoted.
         *
         * The registrar prices independently and pulls with
         * transferFrom, so the only authority on the amount charged
         * is the balance movement. This is what `Renewed` reports.
         */
        unchecked {
            charged =
                beforeRenew -
                USDC.balanceOf(
                    address(this)
                );
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
        if (
            !USDC.approve(
                address(renewer_),
                0
            )
        ) {
            revert ApprovalFailed();
        }

    }

    /*//////////////////////////////////////////////////////////////
                       INTERNAL QUOTE
    //////////////////////////////////////////////////////////////*/

    function _quote(
        IETHRenewer renewer_,
        string memory label,
        uint256 usdcAvailable
    )
        private
        view
        returns (
            uint64 duration,
            uint256 amountNeeded
        )
    {
        /*
         * Every input comes from the oracle the *selected* renewer
         * prices with, fetched fresh. Reading the oracle from
         * anywhere other than the contract about to be called is how
         * the three-way agreement below stops being an invariant. Nothing about the pricing is
         * this contract's own opinion except the inverse search
         * below, and `_renew` checks that against the registrar
         * before it approves anything.
         */
        IENSV2PriceOracle oracle_ =
            renewer_.rentPriceOracle();

        uint256 rate =
            _rateFor(oracle_, label);

        (

            uint128 tokenNumer,
            uint128 tokenDenom
        ) = oracle_.getPaymentTokenRatio(USDC);

        if (
            tokenNumer == 0 ||
            tokenDenom == 0
        ) {
            revert InvalidOracleConfig();
        }

        IENSV2PriceOracle
            .DiscountPoint[]
            memory points =
                oracle_
                    .getDiscountPoints();

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
            denominator =
                oracle_.DISCOUNT_DENOMINATOR();

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
        uint256 budget =
            usdcAvailable *
            uint256(tokenDenom) /
            uint256(tokenNumer);

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

        for (
            uint256 i = points.length;
            i != 0;
        ) {
            unchecked {
                --i;
            }

            IENSV2PriceOracle
                .DiscountPoint
                memory point =
                    points[i];

            /*
             * Exact inverse of ENS's floor:
             *
             * floor(
             *     rate * duration * numer
             *     / denominator
             * ) <= budget
             */
            candidate =
                (
                    (budget + 1) *
                    denominator -
                    1
                ) /
                (
                    rate *
                    uint256(
                        point.numer
                    )
                );

            if (
                candidate >=
                uint256(
                    point.duration
                )
            ) {
                if (
                    candidate >
                    type(uint64).max
                ) {
                    revert DurationOverflow();
                }

                // casting to 'uint64' is safe because the bound is
                // checked immediately above
                duration =
                    // forge-lint: disable-next-line(unsafe-typecast)
                    uint64(
                        candidate
                    );

                /*
                 * Match ENS's discounted standard-unit price.
                 */
                uint256 standardAmount =
                    rate *
                    uint256(duration) *
                    uint256(
                        point.numer
                    ) /
                    denominator;

                /*
                 * Match ENS's ceiling conversion into USDC units.
                 */
                amountNeeded =
                    _toPaymentUnits(
                        standardAmount,
                        tokenNumer,
                        tokenDenom
                    );

                return (
                    duration,
                    amountNeeded
                );
            }
        }

        /*
         * No discount tier is affordable.
         */
        candidate =
            budget /
            rate;

        if (
            candidate >
            type(uint64).max
        ) {
            revert DurationOverflow();
        }

        // casting to 'uint64' is safe because the bound is checked
        // immediately above
        duration =
            // forge-lint: disable-next-line(unsafe-typecast)
            uint64(
                candidate
            );

        amountNeeded =
            _toPaymentUnits(
                rate * uint256(duration),
                tokenNumer,
                tokenDenom
            );
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
    function _selectRenewer(
        string memory label
    )
        private
        view
        returns (IETHRenewer)
    {
        IETHRenewer renewer_ = ethRegistrar;

        if (renewer_.isRenewable(label)) {
            return renewer_;
        }

        renewer_ = ethRenewerV1;

        if (
            address(renewer_) != address(0) &&
            renewer_.isRenewable(label)
        ) {
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
    function _toPaymentUnits(
        uint256 standardAmount,
        uint128 numer,
        uint128 denom
    )
        private
        pure
        returns (uint256)
    {
        return (
            standardAmount *
            uint256(numer) +
            uint256(denom) -
            1
        ) / uint256(denom);
    }

    /**
     * @dev Selects the base rate for a label from the oracle's rate
     * array.
     *
     * Split out of `_quote` for stack depth. The index is the one
     * value on this path that is computed here rather than read from
     * ENS — see `_strlen`.
     */
    function _rateFor(
        IENSV2PriceOracle oracle_,
        string memory label
    )
        private
        view
        returns (uint256 rate)
    {
        uint256 rawLength =
            bytes(label).length;

        /*
         * The same bound ENS applies in `getBasePrice`, which returns
         * zero outside it. Mirrored here so the two public entry
         * points cannot disagree: without it `quote()` answers for a
         * label `NamepassFactory.predictWallet` refuses, which is
         * only ever a way to mislead someone about a name they can
         * never fund.
         */
        if (
            rawLength == 0 ||
            rawLength > MAX_LABEL_BYTES
        ) {
            revert InvalidLabel();
        }

        uint256[] memory rates =
            oracle_.getBaseRates();

        if (rates.length == 0) {
            revert InvalidOracleConfig();
        }

        uint256 length =
            _strlen(label);

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
    function _validatePoints(
        IENSV2PriceOracle.DiscountPoint[] memory points
    )
        private
        pure
    {
        uint256 previousDuration =
            type(uint256).max;

        uint128 previousNumer;

        for (
            uint256 i = points.length;
            i != 0;
        ) {
            unchecked {
                --i;
            }

            IENSV2PriceOracle
                .DiscountPoint
                memory point =
                    points[i];

            if (point.numer == 0) {
                revert InvalidOracleConfig();
            }

            if (
                uint256(point.duration) >=
                previousDuration ||
                (
                    previousNumer != 0 &&
                    point.numer <= previousNumer
                )
            ) {
                revert InvalidOracleConfig();
            }

            previousDuration =
                uint256(point.duration);

            previousNumer =
                point.numer;
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
    function _strlen(
        string memory value
    )
        private
        pure
        returns (
            uint256 length
        )
    {
        bytes memory data =
            bytes(value);

        uint256 i;

        while (
            i < data.length
        ) {
            bytes1 b =
                data[i];

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

    /*//////////////////////////////////////////////////////////////
                        CCTP PARSING
    //////////////////////////////////////////////////////////////*/

    function _readBytes32(
        bytes calldata data,
        uint256 offset
    )
        private
        pure
        returns (
            bytes32 value
        )
    {
        assembly ("memory-safe") {
            value :=
                calldataload(
                    add(
                        data.offset,
                        offset
                    )
                )
        }
    }

    function _readUint32(
        bytes calldata data,
        uint256 offset
    )
        private
        pure
        returns (
            uint32 value
        )
    {
        assembly ("memory-safe") {
            value :=
                shr(
                    224,
                    calldataload(
                        add(
                            data.offset,
                            offset
                        )
                    )
                )
        }
    }

    function _addressToBytes32(
        address value
    )
        private
        pure
        returns (
            bytes32
        )
    {
        return
            bytes32(
                uint256(
                    uint160(
                        value
                    )
                )
            );
    }
}
