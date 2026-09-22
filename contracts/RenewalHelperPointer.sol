// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {INamepassRenewalHelper, INamepassGatewayConfig} from "./interfaces/INamepassRenewalHelper.sol";

/// @notice ENS governance selects the adapter used by one permanent gateway.
/// @dev The executor must be the ENS Timelock. Code checks do not prove governance ownership.
contract RenewalHelperPointer {
    address public immutable factory;
    address public immutable paymentToken;
    address public gateway;
    address public currentHelper;
    address public ensGovernanceExecutor;
    address public pendingGovernanceExecutor;

    error NotGovernance();
    error NotPendingGovernance();
    error InvalidAddress();
    error IncompatibleHelper();

    event GatewayBound(address indexed gateway);
    event HelperUpdated(address indexed previousHelper, address indexed newHelper, bytes32 codeHash);
    event GovernanceTransferStarted(address indexed previousExecutor, address indexed newExecutor);
    event GovernanceExecutorUpdated(address indexed previousExecutor, address indexed newExecutor);

    constructor(address factory_, address paymentToken_, address executor_) {
        if (factory_.code.length == 0 || paymentToken_.code.length == 0 || executor_.code.length == 0) {
            revert InvalidAddress();
        }
        factory = factory_;
        paymentToken = paymentToken_;
        ensGovernanceExecutor = executor_;
        emit GovernanceExecutorUpdated(address(0), executor_);
    }

    modifier onlyGovernance() {
        if (msg.sender != ensGovernanceExecutor) revert NotGovernance();
        _;
    }

    /// @dev The first activation binds the gateway permanently. There is no initializer bypass.
    function setHelper(address next) external onlyGovernance {
        if (next.code.length == 0) revert InvalidAddress();
        INamepassRenewalHelper helper = INamepassRenewalHelper(next);
        address target = helper.gateway();
        if (
            helper.interfaceVersion() != 1 || helper.factory() != factory || helper.paymentToken() != paymentToken
                || target.code.length == 0 || (gateway != address(0) && target != gateway)
        ) revert IncompatibleHelper();
        INamepassGatewayConfig config = INamepassGatewayConfig(target);
        if (config.pointer() != address(this) || config.factory() != factory || config.paymentToken() != paymentToken) {
            revert IncompatibleHelper();
        }
        if (gateway == address(0)) {
            gateway = target;
            emit GatewayBound(target);
        }
        address previous = currentHelper;
        currentHelper = next;
        emit HelperUpdated(previous, next, next.codehash);
    }

    function transferGovernance(address next) external onlyGovernance {
        if (next.code.length == 0 || next == address(this)) revert InvalidAddress();
        pendingGovernanceExecutor = next;
        emit GovernanceTransferStarted(ensGovernanceExecutor, next);
    }

    function cancelGovernanceTransfer() external onlyGovernance {
        delete pendingGovernanceExecutor;
        emit GovernanceTransferStarted(ensGovernanceExecutor, address(0));
    }

    function acceptGovernance() external {
        if (msg.sender != pendingGovernanceExecutor) revert NotPendingGovernance();
        address previous = ensGovernanceExecutor;
        ensGovernanceExecutor = msg.sender;
        delete pendingGovernanceExecutor;
        emit GovernanceExecutorUpdated(previous, msg.sender);
    }
}
