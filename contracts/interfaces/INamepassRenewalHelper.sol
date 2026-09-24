// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Stable interface between the payment gateway and an ENS adapter.
interface INamepassRenewalHelper {
    function interfaceVersion() external view returns (uint256);
    function gateway() external view returns (address);
    function factory() external view returns (address);
    function paymentToken() external view returns (address);
    function quote(string calldata label, uint256 budget) external view returns (uint64 duration, uint256 amountNeeded);
    function renewableBy(string calldata label) external view returns (address);
    function nameState(string calldata label) external view returns (uint64 expiry, address renewer);
    function execute(string calldata label, uint256 budget) external returns (uint64 duration, uint256 charged);
}

interface INamepassGatewayConfig {
    function factory() external view returns (address);
    function paymentToken() external view returns (address);
    function pointer() external view returns (address);
}
