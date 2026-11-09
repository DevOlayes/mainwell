// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Recovery {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/// @notice Non-upgradeable executor with immutable per-asset recovery destinations.
/// @dev The owner deploys this contract and grants each token allowance separately.
///      Anyone may relay execution, but every token can move only to its own constructor-bound
///      destination and only within its owner-approved cumulative cap.
contract ScopedRecoveryExecutor {
    error ZeroAddress();
    error InvalidExpiry();
    error InvalidAssetConfiguration();
    error DuplicateAsset(address asset);
    error GrantAlreadyRevoked();
    error GrantExpired();
    error AssetNotAuthorized(address asset);
    error AmountExceedsRemainingLimit(uint256 requested, uint256 remaining);
    error TransferFailed();
    error ReentrantCall();
    error OwnerOnly();

    address public owner;
    // Legacy/default destination: the first authorized asset's destination. Not used for routing.
    address public destination;
    uint64 public expiresAt;
    bool public revoked;
    bool public automaticPriorityEnabled;
    bool public adminInitiatedEnabled;

    address[] private _authorizedAssets;
    uint256 private _entered = 1;
    mapping(address => uint256) public assetLimit;
    mapping(address => uint256) public amountRecovered;
    mapping(address => address) public assetDestination;

    event TokenRecovered(address indexed token, address indexed destination, uint256 amount, address indexed caller);
    event AssetRevoked(address indexed token);
    event GrantRevoked(address indexed owner);

    modifier onlyOwner() { if (msg.sender != owner) revert OwnerOnly(); _; }
    modifier nonReentrant() {
        if (_entered != 1) revert ReentrantCall();
        _entered = 2; _; _entered = 1;
    }

    constructor(
        uint64 expiresAt_,
        address[] memory assets_,
        address[] memory destinations_,
        uint256[] memory maxAmounts_,
        bool automaticPriorityEnabled_,
        bool adminInitiatedEnabled_
    ) {
        if (expiresAt_ <= block.timestamp) revert InvalidExpiry();
        if (!automaticPriorityEnabled_ && !adminInitiatedEnabled_) revert InvalidAssetConfiguration();
        if (assets_.length == 0 || assets_.length != maxAmounts_.length || assets_.length != destinations_.length) {
            revert InvalidAssetConfiguration();
        }
        owner = msg.sender;
        expiresAt = expiresAt_;
        automaticPriorityEnabled = automaticPriorityEnabled_;
        adminInitiatedEnabled = adminInitiatedEnabled_;
        for (uint256 i = 0; i < assets_.length; i++) {
            address asset = assets_[i];
            address assetDest = destinations_[i];
            uint256 cap = maxAmounts_[i];
            if (asset == address(0) || assetDest == address(0) || cap == 0) revert InvalidAssetConfiguration();
            if (assetLimit[asset] != 0) revert DuplicateAsset(asset);
            assetLimit[asset] = cap;
            assetDestination[asset] = assetDest;
            _authorizedAssets.push(asset);
        }
        destination = destinations_[0];
    }

    function authorizedAssetCount() external view returns (uint256) { return _authorizedAssets.length; }
    function authorizedAssetAt(uint256 index) external view returns (address) { return _authorizedAssets[index]; }
    function authorizedAssetDestinationAt(uint256 index) external view returns (address) {
        return assetDestination[_authorizedAssets[index]];
    }

    function executeToken(address token, uint256 amount) external nonReentrant {
        if (revoked) revert GrantAlreadyRevoked();
        if (block.timestamp >= expiresAt) revert GrantExpired();
        uint256 cap = assetLimit[token];
        if (cap == 0) revert AssetNotAuthorized(token);
        uint256 alreadyRecovered = amountRecovered[token];
        uint256 remaining = cap - alreadyRecovered;
        if (amount == 0 || amount > remaining) revert AmountExceedsRemainingLimit(amount, remaining);
        address recipient = assetDestination[token];
        if (recipient == address(0)) revert InvalidAssetConfiguration();
        amountRecovered[token] = alreadyRecovered + amount;
        (bool success, bytes memory returnData) = token.call(
            abi.encodeWithSelector(IERC20Recovery.transferFrom.selector, owner, recipient, amount)
        );
        if (!success || (returnData.length != 0 && !abi.decode(returnData, (bool)))) revert TransferFailed();
        emit TokenRecovered(token, recipient, amount, msg.sender);
    }

    function revoke() external onlyOwner { revoked = true; emit GrantRevoked(owner); }
    function revokeAsset(address token) external onlyOwner {
        if (assetLimit[token] == 0) revert AssetNotAuthorized(token);
        assetLimit[token] = amountRecovered[token];
        emit AssetRevoked(token);
    }
}
