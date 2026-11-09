// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../src/ScopedRecoveryExecutor.sol";

interface Vm {
    function warp(uint256 timestamp) external;
    function prank(address sender) external;
}

contract MockRecoveryToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 permitted = allowance[from][msg.sender];
        require(permitted >= amount, "allowance");
        require(balanceOf[from] >= amount, "balance");
        allowance[from][msg.sender] = permitted - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract ScopedRecoveryExecutorTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    MockRecoveryToken private token;
    ScopedRecoveryExecutor private executor;
    address private constant DESTINATION = address(0xBEEF);
    address private constant STRANGER = address(0xCAFE);

    function setUp() public {
        token = new MockRecoveryToken();
        address[] memory assets = new address[](1);
        uint256[] memory caps = new uint256[](1);
        assets[0] = address(token);
        caps[0] = 500;
        executor = new ScopedRecoveryExecutor(DESTINATION, uint64(block.timestamp + 1 days), assets, caps);
        token.mint(address(this), 1_000);
        token.approve(address(executor), 1_000);
    }

    function testRecoveryCanOnlySendToImmutableDestination() public {
        vm.prank(STRANGER);
        executor.executeToken(address(token), 200);
        require(token.balanceOf(DESTINATION) == 200, "destination balance");
        require(token.balanceOf(STRANGER) == 0, "caller received tokens");
        require(executor.amountRecovered(address(token)) == 200, "spent accounting");
    }

    function testCumulativeRecoveryCannotExceedOwnerConfiguredCap() public {
        executor.executeToken(address(token), 300);
        (bool ok,) = address(executor).call(
            abi.encodeWithSelector(executor.executeToken.selector, address(token), 201)
        );
        require(!ok, "cap bypassed");
        require(token.balanceOf(DESTINATION) == 300, "unexpected transfer");
    }

    function testUnlistedTokenCannotBeRecovered() public {
        MockRecoveryToken other = new MockRecoveryToken();
        (bool ok,) = address(executor).call(
            abi.encodeWithSelector(executor.executeToken.selector, address(other), 1)
        );
        require(!ok, "unlisted token accepted");
    }

    function testExpiredGrantCannotExecute() public {
        vm.warp(block.timestamp + 1 days);
        (bool ok,) = address(executor).call(
            abi.encodeWithSelector(executor.executeToken.selector, address(token), 1)
        );
        require(!ok, "expired grant executed");
    }

    function testOwnerCanRevokeWholeGrant() public {
        executor.revoke();
        (bool ok,) = address(executor).call(
            abi.encodeWithSelector(executor.executeToken.selector, address(token), 1)
        );
        require(!ok, "revoked grant executed");
    }

    function testOwnerCanRevokeOneAssetWithoutChangingDestination() public {
        executor.revokeAsset(address(token));
        (bool ok,) = address(executor).call(
            abi.encodeWithSelector(executor.executeToken.selector, address(token), 1)
        );
        require(!ok, "revoked asset executed");
        require(executor.destination() == DESTINATION, "destination changed");
    }

    function testNonOwnerCannotRevoke() public {
        vm.prank(STRANGER);
        (bool ok,) = address(executor).call(abi.encodeWithSelector(executor.revoke.selector));
        require(!ok, "non-owner revoked grant");
    }

    function testInsufficientTokenAllowanceBlocksTransfer() public {
        token.approve(address(executor), 0);
        (bool ok,) = address(executor).call(
            abi.encodeWithSelector(executor.executeToken.selector, address(token), 1)
        );
        require(!ok, "transfer without allowance");
        require(executor.amountRecovered(address(token)) == 0, "failed transfer consumed cap");
    }
}
