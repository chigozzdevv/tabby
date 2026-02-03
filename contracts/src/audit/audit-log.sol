// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {RoleManager} from "../access/role-manager.sol";

contract AuditLog is RoleManager {
    event AuditRecord(bytes32 indexed recordId, address indexed actor, bytes32 indexed action, bytes data);

    constructor(address admin) RoleManager(admin) {}

    function record(bytes32 recordId, bytes32 action, bytes calldata data) external onlyRole(ADMIN_ROLE) {
        emit AuditRecord(recordId, msg.sender, action, data);
    }
}
