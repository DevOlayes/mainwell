// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal ERC-20 interface used by the recovery executor.
interface IERC20Recovery {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/// @title ScopedRecoveryExecutor
/// @notice Non-upgradeable ERC-20 recovery executor with immutable owner and destination.
/// @dev The owner must explicitly deploy this contract and approve it as spender for each token.
///      Anyone may pay gas to call executeToken, but tokens can only move from the owner to the
///      immutable destination and only for constructor-allowlisted assets within their raw-unit caps.
///      This contract has no arbitrary-call, arbitrary-recipient, admin-withdrawal, or upgrade path.
///      Native assets, fee-on-transfer tokens, rebasing tokens, NFTs, and non-EVM chains are unsupported.
contract ScopedRecoveryExecutor {
    error ZeroAddress();
    error InvalidExpiry();
    error InvalidAssetConfiguration();
    error DuplicateAsset(address asset);
    error GrantRevoked();
    error GrantExpired();
    error AssetNotAuthorized(address asset);
    error AmountExceedsRemainingLimit(uint256 requested, uint256 remaining);
    error TransferFailed();
    error ReentrantCall();
    error OwnerOnly();

    address public immutable owner;
    address public immutable destination;
    uint64 public immutable expiresAt;

    bool public revoked;
    uint256 private _entered = 1;

    mapping(address => uint256) public assetLimit;
    mapping(address => uint256) public amountRecovered;

    event TokenRecovered(address indexed token, uint256 amount, address indexed caller);
    event AssetRevoked(address indexed token);
    event GrantRevoked(address indexed owner);
    
    modifier onlyOwner() {
        if (msg.sender != owner) revert OwnerOnly();
        _;
    }

    modifier nonReentrant() {
        if (_entered != 1) revert ReentrantCall();
        _entered = 2;
        _;
        _entered = 1;
    }

    constructor(
        address destination_,
        uint64 expiresAt_,
        address[] memory assets_,
        uint256[] memory maxAmounts_
    ) {
        if (destination_ == address(0)) revert ZeroAddress();
        if (expiresAt_ <= block.timestamp) revert InvalidExpiry();
        if (assets_.length == 0 || assets_.length != maxAmounts_.length) {
            revert InvalidAssetConfiguration();
        }

        owner = msg.sender;
        destination = destination_;
        expiresAt = expiresAt_;

        for (uint256 i = 0; i < assets_.length; i++) {
            address asset = assets_[i];
            uint256 cap = maxAmounts_[i];
            if (asset == address(0) || cap == 0) revert InvalidAssetConfiguration();
            if (assetLimit[asset] != 0) revert DuplicateAsset(asset);
            assetLimit[asset] = cap;
        }
    }

    /// @notice Anyone may pay gas, but the transfer destination and asset scope cannot be changed.
    /// @dev maxAmounts may use type(uint256).max only when the owner knowingly chose an unlimited
    ///      contract cap. The token's live ERC-20 allowance remains an independent upper bound.
    function executeToken(address token, uint256 amount) external nonReentrant {
        if (revoked) revert GrantRevoked();
        if (block.timestamp >= expiresAt) revert GrantExpired();

        uint256 cap = assetLimit[token];
        if (cap == 0) revert AssetNotAuthorized(token);

        uint256 alreadyRecovered = amountRecovered[token];
        uint256 remaining = cap - alreadyRecovered;
        if (amount == 0 || amount > remaining) {
            revert AmountExceedsRemainingLimit(amount, remaining);
        }

        // Effects before interaction; any failed token call reverts the state change.
        amountRecovered[token] = alreadyRecovered + amount;
        (bool success, bytes memory returnData) = token.call(
            abi.encodeWithSelector(IERC20Recovery.transferFrom.selector, owner, destination, amount)
        );
        if (!success || (returnData.length != 0 && !abi.decode(returnData, (bool)))) {
            revert TransferFailed();
        }

        emit TokenRecovered(token, amount, msg.sender);
    }

    /// @notice Permanently revoke all remaining recovery execution under this grant.
    function revoke() external onlyOwner {
        revoked = true;
        emit GrantRevoked(owner);
    }

    /// @notice Permanently remove one token from this grant without affecting other assets.
    function revokeAsset(address token) external onlyOwner {
        if (assetLimit[token] == 0) revert AssetNotAuthorized(token);
        assetLimit[token] = amountRecovered[token];
        emit AssetRevoked(token);
    }
}
