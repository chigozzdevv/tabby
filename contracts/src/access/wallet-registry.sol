// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {RoleManager} from "./role-manager.sol";

contract WalletRegistry is RoleManager {
    event WalletStatusUpdated(address indexed wallet, bool allowed, address indexed sender);

    mapping(address => bool) private _allowed;

    constructor(address admin) RoleManager(admin) {}

    function setWalletStatus(address wallet, bool allowed) external onlyRole(ADMIN_ROLE) {
        _allowed[wallet] = allowed;
        emit WalletStatusUpdated(wallet, allowed, msg.sender);
    }

    function isWalletAllowed(address wallet) external view returns (bool) {
        return _allowed[wallet];
    }
}
