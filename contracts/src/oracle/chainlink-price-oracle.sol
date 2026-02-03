// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {RoleManager} from "../access/role-manager.sol";
import {IPriceOracle} from "./i-price-oracle.sol";

interface IChainlinkAggregatorV3 {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

contract ChainlinkPriceOracle is RoleManager, IPriceOracle {
    error InvalidAsset();
    error InvalidFeed();
    error StalePrice();
    error InvalidPrice();

    struct FeedConfig {
        address feed;
        uint48 maxAge;
        bool enabled;
    }

    mapping(address => FeedConfig) public feeds;

    event FeedUpdated(address indexed asset, address indexed feed, uint48 maxAge, bool enabled);

    constructor(address admin) RoleManager(admin) {}

    function setFeed(address asset, address feed, uint48 maxAge, bool enabled) external onlyRole(ADMIN_ROLE) {
        if (asset == address(0)) revert InvalidAsset();
        if (feed == address(0)) revert InvalidFeed();
        feeds[asset] = FeedConfig({feed: feed, maxAge: maxAge, enabled: enabled});
        emit FeedUpdated(asset, feed, maxAge, enabled);
    }

    function getPrice(address asset) external view override returns (uint256) {
        FeedConfig memory cfg = feeds[asset];
        if (!cfg.enabled || cfg.feed == address(0)) return 0;

        (uint80 roundId, int256 answer, , uint256 updatedAt, uint80 answeredInRound) = IChainlinkAggregatorV3(cfg.feed)
            .latestRoundData();

        if (answer <= 0) revert InvalidPrice();
        if (answeredInRound < roundId) revert InvalidPrice();
        if (cfg.maxAge != 0 && (updatedAt == 0 || block.timestamp - updatedAt > cfg.maxAge)) revert StalePrice();

        uint256 price;
        assembly {
            price := answer
        }
        uint8 feedDecimals = IChainlinkAggregatorV3(cfg.feed).decimals();
        if (feedDecimals == 18) return price;
        if (feedDecimals < 18) return price * (10 ** (18 - feedDecimals));
        return price / (10 ** (feedDecimals - 18));
    }
}
