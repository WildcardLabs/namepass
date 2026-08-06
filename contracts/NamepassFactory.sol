// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/*//////////////////////////////////////////////////////////////
                            INTERFACES
//////////////////////////////////////////////////////////////*/

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);

    function transfer(
        address recipient,
        uint256 amount
    ) external returns (bool);

    function approve(
        address spender,
        uint256 amount
    ) external returns (bool);
}

interface ITokenMessengerV2 {
    /**
     * @dev CCTP **V2** returns nothing here. Declaring a return value
     * makes Solidity enforce a returndata size and revert on every
     * burn. Extra returndata, if a future version emits any, is
     * ignored by a void declaration — so this is the safe shape
     * either way.
     */
    function depositForBurnWithHook(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        bytes calldata hookData
    ) external;
}

interface INamepassL1Helper {
    function renewFromWallet(
        string calldata label,
        uint256 amount
    ) external;

    /**
     * @dev Must return the factory this helper derives deposit
     * addresses from. Checked at initialization on Ethereum so a
     * mistyped or unrelated helper cannot be frozen in.
     */
    function factory() external view returns (address);
}

interface INamepassWallet {
    function execute(
        string calldata label,
        uint256 amount,
        uint16 maxFeeBps
    ) external;
}

/*//////////////////////////////////////////////////////////////
                    ERC-1167 MINIMAL PROXY
//////////////////////////////////////////////////////////////*/

library MinimalProxy {
    error DeploymentFailed();

    /**
     * @notice Deploys a standard ERC-1167 minimal proxy with CREATE2.
     *
     * Runtime bytecode: 45 bytes.
     * Creation bytecode: 55 bytes.
     * Storage slots: none.
     */
    function cloneDeterministic(
        address implementation,
        bytes32 salt
    ) internal returns (address instance) {
        assembly ("memory-safe") {
            /*
             * Packs the first portion of the ERC-1167 creation code
             * and the first three bytes of the implementation.
             */
            mstore(
                0x00,
                or(
                    shr(232, shl(96, implementation)),
                    0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000
                )
            )

            /*
             * Packs the remaining seventeen bytes of the
             * implementation and the proxy suffix.
             */
            mstore(
                0x20,
                or(
                    shl(120, implementation),
                    0x5af43d82803e903d91602b57fd5bf3
                )
            )

            instance := create2(
                0,
                0x09,
                0x37,
                salt
            )
        }

        if (instance == address(0)) {
            revert DeploymentFailed();
        }
    }

    /**
     * @notice Predicts the CREATE2 address of the minimal proxy.
     */
    function predictDeterministicAddress(
        address implementation,
        bytes32 salt,
        address deployer
    ) internal pure returns (address predicted) {
        assembly ("memory-safe") {
            let ptr := mload(0x40)

            mstore(add(ptr, 0x38), deployer)

            mstore(
                add(ptr, 0x24),
                0x5af43d82803e903d91602b57fd5bf3ff
            )

            mstore(
                add(ptr, 0x14),
                implementation
            )

            mstore(
                ptr,
                0x3d602d80600a3d3981f3363d3d373d3d3d363d73
            )

            mstore(
                add(ptr, 0x58),
                salt
            )

            mstore(
                add(ptr, 0x78),
                keccak256(
                    add(ptr, 0x0c),
                    0x37
                )
            )

            predicted := and(
                keccak256(
                    add(ptr, 0x43),
                    0x55
                ),
                0xffffffffffffffffffffffffffffffffffffffff
            )
        }
    }
}

/*//////////////////////////////////////////////////////////////
                       NAMEPASS FACTORY
//////////////////////////////////////////////////////////////*/

/**
 * @title NamepassFactory
 *
 * @notice Creates deterministic USDC deposit wallets for normalized
 * ENS labels and processes their balances.
 *
 * @dev A **label** is the single name component with no TLD and no
 * dots — `vitalik`, never `vitalik.eth`. Dots are rejected on chain
 * so an off-chain caller that passes a full name fails loudly at
 * prediction time instead of quietly deriving an address nobody can
 * ever process. User-facing copy still says *name*, because that is
 * what users have; only the on-chain key is a label.
 *
 * Rejecting dots also excludes subnames, which is correct rather
 * than merely convenient: subnames don't pay renewal fees, so a
 * subname deposit address would have nothing to buy.
 *
 * Each deposit wallet is a storage-free ERC-1167 proxy that
 * permanently delegates to this factory.
 *
 * To produce the same deposit address across chains:
 *
 * 1. This factory must be deployed at the same address.
 * 2. The factory runtime bytecode must be identical.
 * 3. The same normalized ENS label bytes must be used.
 * 4. The same salt namespace must be used.
 *
 * Constructor arguments are part of the creation code, so
 * `initialOwner` and `hubChainId` must be identical on every chain
 * in a deployment set. Everything chain-*specific* lives in storage
 * and does not affect deterministic wallet addresses, which is *why*
 * the frozen values below are set-once storage rather than
 * `immutable`. A constructor argument that differed per chain would
 * move the factory address per chain and break the one-address
 * promise outright.
 *
 * `hubChainId` is 1 for mainnet and 11155111 for a Sepolia-based
 * testnet. The two produce different factory addresses, and so
 * different deposit addresses, which is what separate deployments
 * should do.
 *
 * Deployment order:
 *
 * 1. Deploy this factory, same address on every chain, through a
 *    deterministic deployer.
 * 2. Deploy the single L1 helper, hardcoding this factory's address
 *    so it can derive deposit addresses without calling back.
 * 3. `initialize` once per chain. It can never be called again.
 *
 * ## Custody
 *
 * After `initialize`, the owner cannot move a single deposited
 * dollar. Every address that can receive USDC — the local token, the
 * CCTP messenger it is approved to, and the Ethereum helper it is
 * ultimately paid to — is frozen. Two settings remain: the CCTP
 * finality tier and the per-burn maximum. Neither changes where
 * anything goes, only how long it waits and how much travels per
 * transaction.
 *
 * The fee ceiling is deliberately *not* among them. It is supplied
 * per call, so no owner setting can price a transfer or, more to
 * the point, stop one — `renewWithFee` lets anyone push a payment
 * through at their own chosen ceiling if Circle ever starts
 * charging for the tier this chain is set to.
 *
 * There is deliberately **no sweep**. A rescue path is a path that
 * moves a deposit wallet's tokens to an owner-chosen address, and
 * every version of it is one config mistake away from being a
 * withdrawal route for the payment asset itself. Non-USDC tokens
 * sent to a deposit address are therefore permanently lost, and the
 * UI is responsible for saying so plainly.
 */
contract NamepassFactory {
    /*//////////////////////////////////////////////////////////////
                              CONSTANTS
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Circle's CCTP domain for the hub. Zero for both Ethereum
     * mainnet and Sepolia, so it holds across a testnet and a
     * mainnet deployment alike.
     */
    uint32 private constant HUB_CCTP_DOMAIN = 0;

    uint256 private constant BPS_DENOMINATOR = 10_000;

    /**
     * @dev Standard transfers — what an L2 starts on.
     *
     * Circle currently documents values at or below 1000 as Fast and
     * values at or above 2000 as Standard. Anything between the two
     * is not documented. The value is passed through unvalidated for
     * forward compatibility, so the owner must select it carefully —
     * a threshold of 0 means *Fast*, not "unset".
     */
    uint32 private constant FINALITY_FINALIZED = 2000;

    /**
     * @dev Circle's per-burn ceiling today: 10,000,000 USDC at 6 decimals.
     * The value `initialize` starts an L2 at; adjustable afterwards, because
     * this number is Circle's and can move.
     */
    uint96 private constant INITIAL_MAX_BURN = 10_000_000e6;

    /**
     * @dev 100,000 USDC. The lowest the burn cap may be set to.
     *
     * This is not a typo guard, it is what stops the cap being used as a
     * pause. Without a floor an owner can set the cap to one micro-unit, and
     * every `renew` on that chain then moves 0.000001 USDC — funds stay safe
     * at their deposit addresses and become unprocessable, which is exactly
     * the liveness that permissionless `renew` exists to guarantee.
     *
     * With the floor, no payment at or below 100,000 USDC can be affected at
     * all, and a larger one can only be split into 100,000 USDC slices, never
     * stopped. It sits two orders of magnitude under Circle's current limit so
     * it constrains an owner without constraining real configuration if that
     * limit ever moves down.
     */
    uint96 private constant MIN_MAX_BURN = 100_000e6;

    bytes32 private constant WALLET_SALT_NAMESPACE =
        keccak256("NAMEPASS_DEPOSIT_WALLET_V1");

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev The real factory address remains embedded in the
     * implementation bytecode during delegatecall.
     *
     * Direct factory execution:
     * address(this) == SELF
     *
     * Wallet delegatecall execution:
     * address(this) == deterministic wallet
     * SELF          == real factory
     */
    address private immutable SELF;

    /**
     * @dev The chain ENS renewal happens on: 1 for mainnet,
     * 11155111 for a Sepolia-based testnet deployment.
     *
     * A constructor argument rather than a constant so one source
     * file serves both, instead of an edit between deployments that
     * has to be remembered. Constructor arguments are part of the
     * creation code, so this must be **identical across every chain
     * in one deployment set** or the factory lands on a different
     * address per chain and the one-address promise breaks. A
     * testnet set and a mainnet set therefore have different factory
     * addresses, which is correct: they are separate deployments
     * with separate deposit addresses.
     *
     * ENS *pricing* is not assumed anywhere here. The L1 helper
     * reads it from an external contract it can repoint, so rent and
     * discount changes never reach this factory.
     */
    uint256 private immutable HUB_CHAIN_ID;

    address private _owner;

    /// @dev Set by `transferOwnership`, cleared by `acceptOwnership`.
    address private _pendingOwner;

    /*
     * Slot: _usdc | _minFinalityThreshold  (24 bytes)
     */

    /// @dev Native USDC on this chain. Frozen at initialization.
    address private _usdc;

    /// @dev CCTP finality threshold. Owner-adjustable.
    uint32 private _minFinalityThreshold;

    /*
     * Slot: _tokenMessenger | _maxBurnAmount  (exactly 32 bytes)
     */

    /// @dev Local TokenMessengerV2. Zero on Ethereum. Frozen.
    address private _tokenMessenger;

    /**
     * @dev Largest USDC amount to put through a single CCTP burn.
     * Owner-adjustable; zero on Ethereum, where nothing is burned.
     *
     * `uint96` because it packs with the messenger above and still tops out
     * around 79 trillion USDC.
     */
    uint96 private _maxBurnAmount;

    /**
     * @dev The single Ethereum helper. On L2 this is both the CCTP
     * mint recipient and destination caller. Frozen.
     *
     * Doubles as the initialization flag: it is non-zero on every
     * chain once set, so no separate bool is needed.
     */
    address private _l1Helper;

    /*//////////////////////////////////////////////////////////////
                                ERRORS
    //////////////////////////////////////////////////////////////*/

    error NotOwner();
    error NotPendingOwner();
    error WrongExecutionContext();

    error ZeroAddress();
    error InvalidHubChainId();
    error EmptyLabel();
    error DottedLabel();
    error NoUSDC();

    error TransferFailed();
    error ApprovalFailed();
    error NotAContract();
    error PredictionMismatch();

    error NotInitialized();
    error AlreadyInitialized();
    error InvalidHelper();

    error InvalidFinalityThreshold();
    error InvalidMaxBurnAmount();

    error MissingTokenMessenger();
    error UnexpectedTokenMessenger();

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event OwnershipTransferStarted(
        address indexed previousOwner,
        address indexed newOwner
    );

    event OwnershipTransferred(
        address indexed previousOwner,
        address indexed newOwner
    );

    /**
     * @dev Emitted exactly once in the lifetime of the factory. The
     * absence of a second one of these is the on-chain proof that no
     * payment route was ever redirected.
     */
    event Initialized(
        address indexed usdc,
        address indexed tokenMessenger,
        address indexed l1Helper
    );

    event FinalityUpdated(uint32 minFinalityThreshold);

    event MaxBurnAmountUpdated(uint96 maxBurnAmount);

    /**
     * @dev The only on-chain record of the label a wallet belongs
     * to. `labelKey` is a keccak hash and cannot be reversed, so the
     * label ships as data for the indexer to store once.
     */
    event WalletDeployed(
        bytes32 indexed labelKey,
        address indexed wallet,
        string label
    );

    /**
     * @dev One per processed deposit, emitted by the factory rather
     * than the wallet so an indexer watches a single address.
     *
     * On Ethereum this is immediately followed by the helper's own
     * renewal event. On an L2 it marks the burn — the CCTP nonce is
     * in TokenMessengerV2's `DepositForBurn` in the same
     * transaction, and the helper emits the settlement on mainnet.
     *
     * `remaining` is what is still at the deposit address afterwards. It is
     * non-zero when the balance exceeded the per-burn cap, and it is the
     * signal to call `renew` again rather than to wait for another deposit.
     */
    event DepositProcessed(
        bytes32 indexed labelKey,
        address indexed wallet,
        uint256 amount,
        uint256 remaining
    );

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(
        address initialOwner,
        uint256 hubChainId
    ) {
        if (initialOwner == address(0)) {
            revert ZeroAddress();
        }

        if (hubChainId == 0) {
            revert InvalidHubChainId();
        }

        SELF = address(this);

        HUB_CHAIN_ID = hubChainId;

        _owner = initialOwner;

        emit OwnershipTransferred(
            address(0),
            initialOwner
        );
    }

    /*//////////////////////////////////////////////////////////////
                              MODIFIERS
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Requires execution directly on the real factory.
     *
     * This does not restrict who may call view functions. It only
     * prevents factory-management selectors from being executed
     * through a deposit wallet proxy.
     */
    modifier onlyFactoryContext() {
        if (address(this) != SELF) {
            revert WrongExecutionContext();
        }

        _;
    }

    /**
     * @dev Requires execution through a deterministic wallet and
     * requires the real factory to be its immediate caller.
     *
     * Expected call path:
     *
     * factory.renew(label)
     *     -> wallet.execute(label, amount)
     *         -> delegatecall factory.execute(label, amount)
     */
    modifier onlyWalletContext() {
        if (
            address(this) == SELF ||
            msg.sender != SELF
        ) {
            revert WrongExecutionContext();
        }

        _;
    }

    modifier onlyOwner() {
        if (msg.sender != _owner) {
            revert NotOwner();
        }

        _;
    }

    /*//////////////////////////////////////////////////////////////
                                 VIEWS
    //////////////////////////////////////////////////////////////*/

    function owner()
        external
        view
        onlyFactoryContext
        returns (address)
    {
        return _owner;
    }

    function pendingOwner()
        external
        view
        onlyFactoryContext
        returns (address)
    {
        return _pendingOwner;
    }

    function usdc()
        external
        view
        onlyFactoryContext
        returns (address)
    {
        return _usdc;
    }

    function tokenMessenger()
        external
        view
        onlyFactoryContext
        returns (address)
    {
        return _tokenMessenger;
    }

    function l1Helper()
        external
        view
        onlyFactoryContext
        returns (address)
    {
        return _l1Helper;
    }

    function maxBurnAmount()
        external
        view
        onlyFactoryContext
        returns (uint96)
    {
        return _maxBurnAmount;
    }

    function finality()
        external
        view
        onlyFactoryContext
        returns (uint32)
    {
        return _minFinalityThreshold;
    }

    /**
     * @notice Everything a deposit wallet needs, in one call.
     *
     * @dev A wallet executing by delegatecall sees its own (empty)
     * storage, so it cannot read any of this directly.
     */
    function walletParams()
        external
        view
        onlyFactoryContext
        returns (
            address usdcAddress,
            address messenger,
            address helper,
            uint32 minFinalityThreshold
        )
    {
        return (
            _usdc,
            _tokenMessenger,
            _l1Helper,
            _minFinalityThreshold
        );
    }

    /*//////////////////////////////////////////////////////////////
                            ADMIN WRITES
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Freezes every payment route. Callable once, ever.
     *
     * Ethereum:
     *   usdc          = ETHEREUM_USDC
     *   tokenMessenger= address(0)
     *   l1Helper      = NAMEPASS_L1_HELPER
     *
     * L2:
     *   usdc          = LOCAL_NATIVE_USDC
     *   tokenMessenger= LOCAL_TOKEN_MESSENGER_V2
     *   l1Helper      = NAMEPASS_L1_HELPER   (an Ethereum address)
     *
     * @dev The trust window is the gap between deployment and this
     * call. After it, the owner cannot move deposited funds at all.
     *
     * On Ethereum the helper is verified to exist and to point back
     * at this factory. On an L2 neither check is possible — the
     * helper is an Ethereum address with no code locally — so the
     * same value must be verified off chain before publishing any
     * deposit address. Getting it wrong on one L2 sends every CCTP
     * mint from that chain to a permanently wrong recipient.
     */
    function initialize(
        address usdcAddress,
        address messenger,
        address helper
    )
        external
        onlyFactoryContext
        onlyOwner
    {
        if (_l1Helper != address(0)) {
            revert AlreadyInitialized();
        }

        if (
            usdcAddress == address(0) ||
            helper == address(0)
        ) {
            revert ZeroAddress();
        }

        if (usdcAddress.code.length == 0) {
            revert NotAContract();
        }

        if (block.chainid == HUB_CHAIN_ID) {
            if (messenger != address(0)) {
                revert UnexpectedTokenMessenger();
            }

            if (helper.code.length == 0) {
                revert NotAContract();
            }

            if (
                INamepassL1Helper(helper)
                    .factory() != SELF
            ) {
                revert InvalidHelper();
            }
        } else {
            if (messenger == address(0)) {
                revert MissingTokenMessenger();
            }

            if (messenger.code.length == 0) {
                revert NotAContract();
            }

            /*
             * Standard transfers, no fee, until told otherwise.
             */
            _minFinalityThreshold =
                FINALITY_FINALIZED;

            _maxBurnAmount = INITIAL_MAX_BURN;
        }

        _usdc = usdcAddress;
        _tokenMessenger = messenger;
        _l1Helper = helper;

        emit Initialized(
            usdcAddress,
            messenger,
            helper
        );

        emit FinalityUpdated(_minFinalityThreshold);

        emit MaxBurnAmountUpdated(_maxBurnAmount);
    }

    /**
     * @notice Chooses the CCTP tier for this chain.
     *
     * @dev Speed only. The fee ceiling is *not* stored — it is
     * supplied per call, so no setting here can price a transfer.
     *
     * Circle currently documents values at or below 1000 as Fast
     * and at or above 2000 as Standard; the range between is not
     * documented. Passed through unvalidated for forward
     * compatibility, so choose it carefully — 0 means Fast, not
     * "unset".
     *
     * Mutable because a redeploy is not available as a remedy:
     * wallets delegate to this factory forever, so a new factory
     * would not repair a single existing deposit address. The move
     * that matters is switching to Fast on the day Circle stops
     * charging for it.
     */
    function setFinality(
        uint32 minFinalityThreshold
    )
        external
        onlyFactoryContext
        onlyOwner
    {
        if (_l1Helper == address(0)) {
            revert NotInitialized();
        }

        /*
         * There is no CCTP leg on Ethereum. Storing a value that
         * nothing reads invites a later reader to trust it.
         */
        if (
            block.chainid == HUB_CHAIN_ID &&
            minFinalityThreshold != 0
        ) {
            revert InvalidFinalityThreshold();
        }

        _minFinalityThreshold = minFinalityThreshold;

        emit FinalityUpdated(minFinalityThreshold);
    }

    /**
     * @notice Sets the largest USDC amount put through one CCTP burn.
     *
     * @dev Tracks Circle's per-transaction limit, which is Circle's number to
     * change. Adjustable rather than constant because a redeploy is not a
     * remedy here — wallets delegate to this factory permanently, so a new
     * factory would not repair a single existing deposit address.
     *
     * Cannot redirect anything: the destination is frozen either way, and this
     * only decides how much travels per transaction.
     */
    function setMaxBurnAmount(
        uint96 newMaxBurnAmount
    )
        external
        onlyFactoryContext
        onlyOwner
    {
        if (_l1Helper == address(0)) {
            revert NotInitialized();
        }

        if (block.chainid == HUB_CHAIN_ID) {
            /*
             * Nothing is burned on Ethereum. A non-zero value here would be
             * read later as though it constrained something.
             */
            if (newMaxBurnAmount != 0) {
                revert InvalidMaxBurnAmount();
            }
        } else if (newMaxBurnAmount < MIN_MAX_BURN) {
            /*
             * Below the floor the cap stops being a Circle limit and starts
             * being a pause switch. See MIN_MAX_BURN.
             */
            revert InvalidMaxBurnAmount();
        }

        _maxBurnAmount = newMaxBurnAmount;

        emit MaxBurnAmountUpdated(newMaxBurnAmount);
    }

    /**
     * @notice Nominates a new owner. Two-step: they must accept.
     *
     * @dev The owner cannot move funds, which makes two-step *more*
     * appropriate here, not less. The only thing ownership carries
     * is the ability to retune CCTP settings, and that ability is
     * the sole defence deposit wallets have against Circle changing
     * something — the wallets are permanent and cannot be
     * redeployed. A mistyped address in a single-step transfer would
     * strand every published address on today's settings forever.
     */
    function transferOwnership(
        address newOwner
    )
        external
        onlyFactoryContext
        onlyOwner
    {
        if (newOwner == address(0)) {
            revert ZeroAddress();
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
    function acceptOwnership()
        external
        onlyFactoryContext
    {
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
                    DETERMINISTIC ADDRESS LOGIC
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Predicts the deposit address for an ENS label.
     *
     * @dev The supplied label must already be ENSIP-15 normalized
     * and must not include the TLD. The exact UTF-8 bytes are used
     * to derive the wallet salt.
     */
    function predictWallet(
        string calldata label
    )
        external
        view
        onlyFactoryContext
        returns (address)
    {
        return _predict(
            _walletSalt(
                _labelKey(label)
            )
        );
    }

    function _labelKey(
        string calldata label
    )
        private
        pure
        returns (bytes32)
    {
        bytes calldata raw = bytes(label);

        if (raw.length == 0) {
            revert EmptyLabel();
        }

        /*
         * A label is one component. A caller passing "vitalik.eth"
         * would otherwise derive a perfectly valid address that no
         * renewal can ever be executed against — and with no sweep,
         * anything sent there is gone.
         */
        for (uint256 i; i < raw.length; ++i) {
            if (raw[i] == 0x2e) {
                revert DottedLabel();
            }
        }

        return keccak256(raw);
    }

    function _walletSalt(
        bytes32 labelKey
    )
        private
        pure
        returns (bytes32 salt)
    {
        bytes32 namespace =
            WALLET_SALT_NAMESPACE;

        assembly ("memory-safe") {
            mstore(0x00, namespace)
            mstore(0x20, labelKey)

            salt := keccak256(
                0x00,
                0x40
            )
        }
    }

    function _predict(
        bytes32 salt
    )
        private
        view
        returns (address)
    {
        return MinimalProxy
            .predictDeterministicAddress(
                SELF,
                salt,
                SELF
            );
    }

    /*//////////////////////////////////////////////////////////////
                          API ENTRYPOINT
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Processes all native USDC currently held by the
     * deterministic wallet for `label`.
     *
     * @dev Permissionless, and authorizes **no** CCTP fee — which
     * is the right default while Standard is free. Every destination
     * is frozen, so the caller chooses nothing except to spend their
     * own gas pushing a deposit along the one path it can take. This
     * removes the backend as a liveness dependency: a funder can
     * always complete their own payment.
     *
     * See `renewWithFee` for the case where Circle prices the tier
     * this chain is set to.
     */
    function renew(
        string calldata label
    )
        external
        onlyFactoryContext
    {
        _renew(label, 0);
    }

    /**
     * @notice Same, but authorizes Circle to charge up to
     * `maxFeeBps` of the transfer.
     *
     * @dev The escape hatch. `renew` authorizes nothing, which is
     * right while Standard is free — but if Circle ever prices it,
     * every zero-fee burn reverts and the funds would sit at their
     * deposit addresses with no way to move. Because this is
     * permissionless, anyone can then push their own payment through
     * without waiting for Namepass to notice.
     *
     * The ceiling is a per-call argument rather than stored state so
     * that no owner setting can price a transfer, or stop one. What
     * that trades: anyone can authorize Circle's fee on someone
     * else's deposit. They cannot receive it, redirect anything, or
     * make Circle take the full ceiling — Circle charges its actual
     * fee — so the worst case is a funder paying the going rate for
     * speed they did not ask for, and only when this chain is set to
     * Fast at all.
     *
     * Solidity has no default arguments, hence two named functions
     * rather than an overload — the selectors stay legible from a
     * frontend.
     */
    function renewWithFee(
        string calldata label,
        uint16 maxFeeBps
    )
        external
        onlyFactoryContext
    {
        _renew(label, maxFeeBps);
    }

    function _renew(
        string calldata label,
        uint16 maxFeeBps
    )
        private
    {
        if (_l1Helper == address(0)) {
            revert NotInitialized();
        }

        bytes32 labelKey = _labelKey(label);

        bytes32 salt = _walletSalt(labelKey);

        address wallet = _predict(salt);

        /*
         * Read before deploying. An empty wallet would otherwise be
         * created and then rolled back by the revert below, paying
         * for a deployment that does not survive the transaction.
         *
         * This is also the only balance read in the flow — the
         * amount is handed to the wallet rather than looked up a
         * second time from inside it.
         */
        uint256 balance =
            IERC20(_usdc).balanceOf(wallet);

        if (balance == 0) {
            revert NoUSDC();
        }

        uint256 amount = balance;

        /*
         * Circle rejects a burn above its per-transaction limit, and a retry
         * would be the same oversized burn — so an over-limit balance would
         * sit here indefinitely rather than fail once and recover. Take a
         * slice instead and let repeated calls drain the rest.
         *
         * Ethereum is uncapped: nothing is burned there, only transferred to
         * the helper, and no limit applies to that.
         */
        if (
            block.chainid !=
            HUB_CHAIN_ID &&
            amount > _maxBurnAmount
        ) {
            amount = _maxBurnAmount;
        }

        _deployIfNeeded(
            wallet,
            salt,
            labelKey,
            label
        );

        INamepassWallet(wallet)
            .execute(label, amount, maxFeeBps);

        emit DepositProcessed(
            labelKey,
            wallet,
            amount,
            balance - amount
        );
    }

    function _deployIfNeeded(
        address wallet,
        bytes32 salt,
        bytes32 labelKey,
        string calldata label
    )
        private
    {
        if (wallet.code.length != 0) {
            return;
        }

        address deployed =
            MinimalProxy.cloneDeterministic(
                SELF,
                salt
            );

        /*
         * Prediction and deployment are two separate assembly
         * blocks that must agree. They do — but only one of them
         * could be edited later, and the failure would be silent
         * and unrecoverable: funds sent to the advertised address
         * with the code somewhere else. One comparison, once per
         * wallet, closes that off.
         */
        if (deployed != wallet) {
            revert PredictionMismatch();
        }

        emit WalletDeployed(
            labelKey,
            wallet,
            label
        );
    }

    /*//////////////////////////////////////////////////////////////
                 LOGIC EXECUTED INSIDE EACH WALLET
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Runs through delegatecall inside the deterministic
     * wallet.
     *
     * @dev The wallet stores nothing. The label and the amount are
     * supplied only as transaction calldata.
     *
     * Direct calls to the wallet are rejected because only the real
     * factory can be msg.sender in wallet execution context, and the
     * factory guarantees `amount` is the wallet's live USDC balance
     * and non-zero.
     *
     * A second label-to-wallet calculation is not needed here:
     *
     * 1. factory.renew(label) derives the wallet from that label;
     * 2. the factory calls only that derived wallet;
     * 3. direct wallet execution is rejected;
     * 4. the factory exposes no arbitrary wallet-call function.
     */
    function execute(
        string calldata label,
        uint256 amount,
        uint16 maxFeeBps
    )
        external
        onlyWalletContext
    {
        /*
         * Delegatecall uses the wallet's storage. The wallet has no
         * configuration, so it is fetched through an external call
         * to the real factory.
         */
        (
            address usdcAddress,
            address messenger,
            address helper,
            uint32 minFinalityThreshold
        ) = NamepassFactory(SELF).walletParams();

        if (
            block.chainid ==
            HUB_CHAIN_ID
        ) {
            _executeEthereum(
                usdcAddress,
                helper,
                label,
                amount
            );
        } else {
            _executeL2(
                usdcAddress,
                messenger,
                helper,
                maxFeeBps,
                minFinalityThreshold,
                label,
                amount
            );
        }
    }

    /*//////////////////////////////////////////////////////////////
                          ETHEREUM PATH
    //////////////////////////////////////////////////////////////*/

    function _executeEthereum(
        address usdcAddress,
        address helper,
        string calldata label,
        uint256 amount
    )
        private
    {
        /*
         * The transfer and helper call are atomic.
         *
         * If renewFromWallet() reverts, the USDC transfer also
         * reverts and the funds stay at the deposit address, where
         * the sender left them and where the pending-balance card
         * can still see them.
         */
        _safeTransfer(
            usdcAddress,
            helper,
            amount
        );

        INamepassL1Helper(helper)
            .renewFromWallet(
                label,
                amount
            );
    }

    /*//////////////////////////////////////////////////////////////
                              L2 PATH
    //////////////////////////////////////////////////////////////*/

    function _executeL2(
        address usdcAddress,
        address messenger,
        address helper,
        uint16 maxFeeBps,
        uint32 minFinalityThreshold,
        string calldata label,
        uint256 amount
    )
        private
    {
        /*
         * TokenMessengerV2 pulls exactly `amount` from this wallet.
         *
         * A successful burn consumes the allowance. If the burn
         * reverts, the approval also reverts.
         */
        _safeApprove(
            usdcAddress,
            messenger,
            amount
        );

        bytes32 helperBytes32 =
            bytes32(
                uint256(
                    uint160(helper)
                )
            );

        /*
         * Convert the configured bps cap into USDC subunits.
         *
         * The calculation rounds upward so the resulting unit cap
         * is not accidentally one token subunit below the configured
         * percentage.
         */
        uint256 maxFee =
            (
                amount *
                uint256(maxFeeBps) +
                BPS_DENOMINATOR -
                1
            ) /
            BPS_DENOMINATOR;

        /*
         * The transfer must always leave at least one burn-token
         * subunit available to mint on Ethereum.
         */
        if (maxFee >= amount) {
            unchecked {
                maxFee = amount - 1;
            }
        }

        /*
         * Raw label bytes, not abi.encode — the helper reads this
         * as string(hookData).
         */
        ITokenMessengerV2(messenger)
            .depositForBurnWithHook(
                amount,
                HUB_CCTP_DOMAIN,
                helperBytes32, // mintRecipient
                usdcAddress,
                helperBytes32, // destinationCaller
                maxFee,
                minFinalityThreshold,
                bytes(label)
            );
    }

    /*//////////////////////////////////////////////////////////////
                          TOKEN HELPERS
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Tolerates a token that returns nothing instead of a bool.
     * Native USDC returns one on all four target chains; this costs
     * a few bytes and removes a class of chain-specific surprise.
     */
    function _safeTransfer(
        address token,
        address to,
        uint256 amount
    )
        private
    {
        (bool ok, bytes memory data) =
            token.call(
                abi.encodeCall(
                    IERC20.transfer,
                    (to, amount)
                )
            );

        if (
            !ok ||
            (
                data.length != 0 &&
                !abi.decode(data, (bool))
            )
        ) {
            revert TransferFailed();
        }
    }

    function _safeApprove(
        address token,
        address spender,
        uint256 amount
    )
        private
    {
        (bool ok, bytes memory data) =
            token.call(
                abi.encodeCall(
                    IERC20.approve,
                    (spender, amount)
                )
            );

        if (
            !ok ||
            (
                data.length != 0 &&
                !abi.decode(data, (bool))
            )
        ) {
            revert ApprovalFailed();
        }
    }
}
