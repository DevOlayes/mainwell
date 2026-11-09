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
    address private constant AUTOMATION_OPERATOR = address(0xA110);
    address private constant ADMIN_OPERATOR = address(0xAD01);

    function setUp() public {
        token = new MockRecoveryToken();
        address[] memory assets = new address[](1);
        address[] memory destinations = new address[](1);
        uint256[] memory caps = new uint256[](1);
        assets[0] = address(token);
        destinations[0] = DESTINATION;
        caps[0] = 500;
        executor = new ScopedRecoveryExecutor(uint64(block.timestamp + 1 days), assets, destinations, caps, true, true, AUTOMATION_OPERATOR, ADMIN_OPERATOR);
        token.mint(address(this), 1_000);
        token.approve(address(executor), 1_000);
    }


    function testAutomaticModeRequiresDedicatedAutomationOperator() public {
        vm.prank(AUTOMATION_OPERATOR);
        executor.executeAutomaticToken(address(token), 100);
        require(token.balanceOf(DESTINATION) == 100, "automatic transfer missing");
    }

    function testAdminOperatorCannotCallAutomaticMode() public {
        vm.prank(ADMIN_OPERATOR);
        (bool ok,) = address(executor).call(abi.encodeWithSelector(executor.executeAutomaticToken.selector, address(token), 1));
        require(!ok, "admin bypassed automatic role");
    }

    function testAutomationOperatorCannotCallAdminMode() public {
        vm.prank(AUTOMATION_OPERATOR);
        (bool ok,) = address(executor).call(abi.encodeWithSelector(executor.executeAdminToken.selector, address(token), 1));
        require(!ok, "automation bypassed admin role");
    }

    function testStrangerCannotExecuteRecovery() public {
        vm.prank(STRANGER);
        (bool ok,) = address(executor).call(abi.encodeWithSelector(executor.executeAdminToken.selector, address(token), 1));
        require(!ok, "unauthorized caller executed recovery");
    }

    function testExecutionModesAndExactAssetScopeAreImmutable() public {
        require(executor.automaticPriorityEnabled(), "automatic mode missing");
        require(executor.adminInitiatedEnabled(), "admin mode missing");
        require(executor.authorizedAssetCount() == 1, "asset count");
        require(executor.authorizedAssetAt(0) == address(token), "asset mismatch");
    }

    function testRecoveryCanOnlySendToImmutableDestination() public {
        vm.prank(ADMIN_OPERATOR);
        executor.executeAdminToken(address(token), 200);
        require(token.balanceOf(DESTINATION) == 200, "destination balance");
        require(token.balanceOf(STRANGER) == 0, "caller received tokens");
        require(executor.amountRecovered(address(token)) == 200, "spent accounting");
    }

    function testEachAssetUsesItsOwnImmutableDestination() public {
        MockRecoveryToken second = new MockRecoveryToken();
        address secondDestination = address(0xD00D);
        address[] memory assets = new address[](2);
        address[] memory destinations = new address[](2);
        uint256[] memory caps = new uint256[](2);
        assets[0] = address(token); assets[1] = address(second);
        destinations[0] = DESTINATION; destinations[1] = secondDestination;
        caps[0] = 500; caps[1] = 700;
        ScopedRecoveryExecutor multi = new ScopedRecoveryExecutor(uint64(block.timestamp + 1 days), assets, destinations, caps, true, true);
        second.mint(address(this), 700);
        second.approve(address(multi), 700);
        multi.executeAdminToken(address(second), 300);
        require(second.balanceOf(secondDestination) == 300, "asset-specific destination not used");
        require(second.balanceOf(DESTINATION) == 0, "asset sent to another asset destination");
        require(multi.assetDestination(address(second)) == secondDestination, "destination binding missing");
    }

    function testCumulativeRecoveryCannotExceedOwnerConfiguredCap() public {
        executor.executeToken(address(token), 300);
        (bool ok,) = address(executor).call(
            abi.encodeWithSelector(executor.executeAdminToken.selector, address(token), 201)
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
