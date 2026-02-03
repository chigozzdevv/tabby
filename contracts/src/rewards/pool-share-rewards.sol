// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {RoleManager} from "../access/role-manager.sol";
import {SafeErc20} from "../libraries/safe-erc20.sol";

interface IPoolShares {
    function lockShares(address account, uint256 shares) external;
    function unlockShares(address account, uint256 shares) external;
}

contract PoolShareRewards is RoleManager {
    using SafeErc20 for address;

    error InvalidAddress();
    error InvalidAmount();
    error InsufficientStake();

    address public immutable pool;
    address public immutable rewardToken;

    uint256 public totalStakedShares;
    mapping(address => uint256) public stakedShares;

    uint256 public rewardPerShareStored;
    mapping(address => uint256) public userRewardPerSharePaid;
    mapping(address => uint256) public rewards;

    uint256 public pendingRewards;

    event Staked(address indexed account, uint256 shares);
    event Unstaked(address indexed account, uint256 shares);
    event RewardAdded(uint256 amount);
    event RewardPaid(address indexed account, uint256 amount);

    constructor(address admin, address pool_, address rewardToken_) RoleManager(admin) {
        if (pool_ == address(0) || rewardToken_ == address(0)) revert InvalidAddress();
        pool = pool_;
        rewardToken = rewardToken_;
    }

    function stake(uint256 shares) external {
        if (shares == 0) revert InvalidAmount();
        _updateReward(msg.sender);

        IPoolShares(pool).lockShares(msg.sender, shares);

        stakedShares[msg.sender] += shares;
        totalStakedShares += shares;
        emit Staked(msg.sender, shares);
    }

    function unstake(uint256 shares) external {
        if (shares == 0) revert InvalidAmount();
        uint256 staked = stakedShares[msg.sender];
        if (shares > staked) revert InsufficientStake();
        _updateReward(msg.sender);

        stakedShares[msg.sender] = staked - shares;
        totalStakedShares -= shares;

        IPoolShares(pool).unlockShares(msg.sender, shares);

        emit Unstaked(msg.sender, shares);
    }

    function claim() external returns (uint256 amount) {
        _updateReward(msg.sender);
        amount = rewards[msg.sender];
        if (amount == 0) return 0;
        rewards[msg.sender] = 0;
        rewardToken.safeTransfer(msg.sender, amount);
        emit RewardPaid(msg.sender, amount);
    }

    function notifyRewardAmount(uint256 amount) external {
        if (amount == 0) revert InvalidAmount();
        rewardToken.safeTransferFrom(msg.sender, address(this), amount);

        if (totalStakedShares == 0) {
            pendingRewards += amount;
            emit RewardAdded(amount);
            return;
        }

        uint256 distribute = amount + pendingRewards;
        pendingRewards = 0;
        rewardPerShareStored += (distribute * 1e18) / totalStakedShares;
        emit RewardAdded(distribute);
    }

    function earned(address account) public view returns (uint256) {
        uint256 perShare = rewardPerShareStored - userRewardPerSharePaid[account];
        return rewards[account] + ((stakedShares[account] * perShare) / 1e18);
    }

    function _updateReward(address account) internal {
        rewards[account] = earned(account);
        userRewardPerSharePaid[account] = rewardPerShareStored;
    }
}
