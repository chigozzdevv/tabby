// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

contract MockChainlinkAggregatorV3 {
    uint8 public immutable decimals;

    int256 private _answer;
    uint256 private _updatedAt;
    uint80 private _roundId;

    constructor(uint8 decimals_, int256 initialAnswer) {
        decimals = decimals_;
        setAnswer(initialAnswer);
    }

    function setAnswer(int256 newAnswer) public {
        _answer = newAnswer;
        _updatedAt = block.timestamp;
        _roundId += 1;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        roundId = _roundId;
        answer = _answer;
        startedAt = _updatedAt;
        updatedAt = _updatedAt;
        answeredInRound = _roundId;
    }
}

