// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title TestGovernance
/// @notice Minimal contract-admin adapter for testnet-only deployments.
/// @dev Its owner can execute arbitrary calls, so it must never be used in production.
contract TestGovernance is Ownable {
    error ZeroAddress();
    error CallFailed(bytes returnData);

    constructor(address owner_) Ownable(owner_) {
        if (owner_ == address(0)) revert ZeroAddress();
    }

    function execute(address target, bytes calldata data) external onlyOwner returns (bytes memory result) {
        if (target == address(0)) revert ZeroAddress();
        // solhint-disable-next-line avoid-low-level-calls
        (bool ok, bytes memory returnData) = target.call(data);
        if (!ok) revert CallFailed(returnData);
        return returnData;
    }
}
