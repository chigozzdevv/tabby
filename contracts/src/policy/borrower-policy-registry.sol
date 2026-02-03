// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @notice Per-borrower policy owned by a human (or operator) address.
/// @dev This is chain-agnostic policy gating; identity verification (Moltbook) is handled offchain.
contract BorrowerPolicyRegistry {
    error Unauthorized();
    error InvalidAddress();
    error AlreadyRegistered();
    error NotRegistered();

    struct Policy {
        address owner;
        uint256 maxPrincipal;
        uint256 maxInterestBps; // APR cap (basis points)
        uint256 maxDurationSeconds;
        uint256 allowedActions; // bitmask: action i is allowed if (allowedActions & (1 << i)) != 0
        bool enabled;
    }

    mapping(address => Policy) public policies;

    event BorrowerRegistered(address indexed borrower, address indexed owner);
    event BorrowerOwnerUpdated(address indexed borrower, address indexed oldOwner, address indexed newOwner);
    event PolicyUpdated(
        address indexed borrower,
        uint256 maxPrincipal,
        uint256 maxInterestBps,
        uint256 maxDurationSeconds,
        uint256 allowedActions,
        bool enabled
    );

    modifier onlyOwner(address borrower) {
        if (policies[borrower].owner != msg.sender) revert Unauthorized();
        _;
    }

    function registerBorrower(
        address borrower,
        uint256 maxPrincipal,
        uint256 maxInterestBps,
        uint256 maxDurationSeconds,
        uint256 allowedActions
    ) external {
        if (borrower == address(0)) revert InvalidAddress();
        if (policies[borrower].owner != address(0)) revert AlreadyRegistered();

        policies[borrower] = Policy({
            owner: msg.sender,
            maxPrincipal: maxPrincipal,
            maxInterestBps: maxInterestBps,
            maxDurationSeconds: maxDurationSeconds,
            allowedActions: allowedActions,
            enabled: true
        });

        emit BorrowerRegistered(borrower, msg.sender);
        emit PolicyUpdated(borrower, maxPrincipal, maxInterestBps, maxDurationSeconds, allowedActions, true);
    }

    function setPolicy(
        address borrower,
        uint256 maxPrincipal,
        uint256 maxInterestBps,
        uint256 maxDurationSeconds,
        uint256 allowedActions,
        bool enabled
    ) external onlyOwner(borrower) {
        if (policies[borrower].owner == address(0)) revert NotRegistered();
        policies[borrower].maxPrincipal = maxPrincipal;
        policies[borrower].maxInterestBps = maxInterestBps;
        policies[borrower].maxDurationSeconds = maxDurationSeconds;
        policies[borrower].allowedActions = allowedActions;
        policies[borrower].enabled = enabled;
        emit PolicyUpdated(borrower, maxPrincipal, maxInterestBps, maxDurationSeconds, allowedActions, enabled);
    }

    function transferBorrowerOwnership(address borrower, address newOwner) external onlyOwner(borrower) {
        if (newOwner == address(0)) revert InvalidAddress();
        address old = policies[borrower].owner;
        if (old == address(0)) revert NotRegistered();
        policies[borrower].owner = newOwner;
        emit BorrowerOwnerUpdated(borrower, old, newOwner);
    }
}

