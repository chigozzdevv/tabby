// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

library SafeErc20 {
    error Erc20CallFailed();

    function safeTransfer(address token, address to, uint256 amount) internal {
        _call(token, abi.encodeWithSignature("transfer(address,uint256)", to, amount));
    }

    function safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        _call(token, abi.encodeWithSignature("transferFrom(address,address,uint256)", from, to, amount));
    }

    function safeApprove(address token, address spender, uint256 amount) internal {
        _call(token, abi.encodeWithSignature("approve(address,uint256)", spender, amount));
    }

    function _call(address token, bytes memory data) private {
        (bool success, bytes memory result) = token.call(data);
        if (!success || (result.length != 0 && !abi.decode(result, (bool)))) {
            revert Erc20CallFailed();
        }
    }
}
