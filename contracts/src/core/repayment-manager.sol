// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {RoleManager} from "../access/role-manager.sol";

contract RepaymentManager is RoleManager {
    error InvalidAmount();
    error LoanNotFound();
    error LoanAlreadyClosed();
    error AlreadyRegistered();

    struct RepaymentState {
        uint256 principal;
        uint256 rateBps;
        uint256 lastAccruedAt;
        uint256 accruedInterest;
        uint256 totalRepaid;
        bool closed;
    }

    mapping(uint256 => RepaymentState) public repayments;

    event InterestAccrued(uint256 indexed loanId, uint256 interestAmount);
    event RepaymentRecorded(uint256 indexed loanId, address indexed payer, uint256 amount);
    event LoanRegistered(uint256 indexed loanId, uint256 principal, uint256 rateBps);
    event LoanClosed(uint256 indexed loanId);

    constructor(address admin) RoleManager(admin) {}

    function registerLoan(uint256 loanId, uint256 principal, uint256 rateBps, uint256 openedAt) external onlyRole(ADMIN_ROLE) {
        if (repayments[loanId].lastAccruedAt != 0) revert AlreadyRegistered();
        if (principal == 0) revert InvalidAmount();
        repayments[loanId] = RepaymentState({
            principal: principal,
            rateBps: rateBps,
            lastAccruedAt: openedAt,
            accruedInterest: 0,
            totalRepaid: 0,
            closed: false
        });
        emit LoanRegistered(loanId, principal, rateBps);
    }

    function previewRepayment(uint256 principal, uint256 rateBps, uint256 elapsedSeconds) public pure returns (uint256) {
        return principal + _simpleInterest(principal, rateBps, elapsedSeconds);
    }

    function previewOutstanding(uint256 loanId) external view returns (uint256) {
        RepaymentState memory state = repayments[loanId];
        if (state.lastAccruedAt == 0 || state.closed) return 0;
        uint256 elapsed = block.timestamp > state.lastAccruedAt ? block.timestamp - state.lastAccruedAt : 0;
        uint256 pending = _simpleInterest(state.principal, state.rateBps, elapsed);
        return state.principal + state.accruedInterest + pending;
    }

    function accrueInterest(uint256 loanId) external onlyRole(ADMIN_ROLE) {
        RepaymentState storage state = repayments[loanId];
        if (state.lastAccruedAt == 0) revert LoanNotFound();
        if (state.closed) revert LoanAlreadyClosed();
        uint256 elapsed = block.timestamp > state.lastAccruedAt ? block.timestamp - state.lastAccruedAt : 0;
        if (elapsed == 0) return;
        uint256 interest = _simpleInterest(state.principal, state.rateBps, elapsed);
        state.accruedInterest += interest;
        state.lastAccruedAt = block.timestamp;
        emit InterestAccrued(loanId, interest);
    }

    function recordRepayment(uint256 loanId, uint256 amount, address payer) external onlyRole(ADMIN_ROLE) {
        if (amount == 0) revert InvalidAmount();
        RepaymentState storage state = repayments[loanId];
        if (state.lastAccruedAt == 0) revert LoanNotFound();
        if (state.closed) revert LoanAlreadyClosed();

        uint256 elapsed = block.timestamp > state.lastAccruedAt ? block.timestamp - state.lastAccruedAt : 0;
        if (elapsed > 0) {
            uint256 interest = _simpleInterest(state.principal, state.rateBps, elapsed);
            state.accruedInterest += interest;
            state.lastAccruedAt = block.timestamp;
            emit InterestAccrued(loanId, interest);
        }

        uint256 outstanding = state.principal + state.accruedInterest;
        if (amount > outstanding) revert InvalidAmount();

        uint256 remaining = amount;
        if (state.accruedInterest > 0) {
            uint256 interestPaid = remaining > state.accruedInterest ? state.accruedInterest : remaining;
            state.accruedInterest -= interestPaid;
            remaining -= interestPaid;
        }

        if (remaining > 0) {
            uint256 principalPaid = remaining > state.principal ? state.principal : remaining;
            state.principal -= principalPaid;
            remaining -= principalPaid;
        }

        state.totalRepaid += amount;
        emit RepaymentRecorded(loanId, payer, amount);

        if (state.principal == 0 && state.accruedInterest == 0) {
            state.closed = true;
            emit LoanClosed(loanId);
        }
    }

    function closeLoan(uint256 loanId) external onlyRole(ADMIN_ROLE) {
        RepaymentState storage state = repayments[loanId];
        if (state.lastAccruedAt == 0) revert LoanNotFound();
        state.closed = true;
        emit LoanClosed(loanId);
    }

    function _simpleInterest(uint256 principal, uint256 rateBps, uint256 elapsedSeconds) internal pure returns (uint256) {
        return (principal * rateBps * elapsedSeconds) / (10000 * 365 days);
    }
}
