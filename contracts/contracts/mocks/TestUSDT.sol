// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title TestUSDT
/// @notice Publicly mintable six-decimal token for Amoy-only acceptance testing.
/// @dev Never deploy this contract on a production network or configure it as production USDT.
contract TestUSDT is ERC20 {
    uint8 private constant TOKEN_DECIMALS = 6;

    constructor() ERC20("Test Tether USD", "USDT") {}

    function decimals() public pure override returns (uint8) {
        return TOKEN_DECIMALS;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
