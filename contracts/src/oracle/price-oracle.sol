// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {RoleManager} from "../access/role-manager.sol";

contract PriceOracle is RoleManager {
    mapping(address => uint256) private _prices;

    event PriceUpdated(address indexed asset, uint256 price, address indexed sender);

    constructor(address admin) RoleManager(admin) {}

    function setPrice(address asset, uint256 price) external onlyRole(ADMIN_ROLE) {
        _prices[asset] = price;
        emit PriceUpdated(asset, price, msg.sender);
    }

    function getPrice(address asset) external view returns (uint256) {
        return _prices[asset];
    }
}
