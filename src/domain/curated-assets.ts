/**
 * Curated, widely used ERC-20 assets for Mainwell's supported EVM networks.
 * Addresses are sourced from issuer documentation or established protocol
 * deployment references. Every entry is independently checked against the
 * configured network RPC (chain ID, deployed bytecode and decimals) before
 * it is activated in the supported-asset registry.
 *
 * Bridged assets are labelled explicitly; they are not represented as issuer-
 * native deployments. This list is a starter set, not an exhaustive universe.
 */
export interface CuratedErc20Asset {
  network: "ethereum" | "polygon" | "bsc" | "avalanche" | "arbitrum" | "optimism" | "base";
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  provenance: string;
}

export const CURATED_ERC20_ASSETS: CuratedErc20Asset[] = [
  // Circle-native USDC (6 decimals).
  {network:"ethereum",address:"0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",symbol:"USDC",name:"USD Coin",decimals:6,provenance:"Circle native USDC"},
  {network:"polygon",address:"0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",symbol:"USDC",name:"USD Coin",decimals:6,provenance:"Circle native USDC"},
  {network:"avalanche",address:"0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",symbol:"USDC",name:"USD Coin",decimals:6,provenance:"Circle native USDC"},
  {network:"arbitrum",address:"0xaf88d065e77c8cC2239327C5EDb3A432268e5831",symbol:"USDC",name:"USD Coin",decimals:6,provenance:"Circle native USDC"},
  {network:"optimism",address:"0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",symbol:"USDC",name:"USD Coin",decimals:6,provenance:"Circle native USDC"},
  {network:"base",address:"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",symbol:"USDC",name:"USD Coin",decimals:6,provenance:"Circle native USDC"},

  // DAI deployments commonly used on the supported EVM networks.
  {network:"ethereum",address:"0x6B175474E89094C44Da98b954EedeAC495271d0F",symbol:"DAI",name:"Dai Stablecoin",decimals:18,provenance:"Maker/Sky DAI"},
  {network:"polygon",address:"0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",symbol:"DAI",name:"Dai Stablecoin",decimals:18,provenance:"Polygon DAI deployment"},
  {network:"bsc",address:"0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3",symbol:"DAI",name:"Dai Token",decimals:18,provenance:"BNB Chain bridged DAI"},
  {network:"avalanche",address:"0xd586E7F844cEa2F87f50152665BCbc2C279D8d70",symbol:"DAI",name:"Dai Stablecoin",decimals:18,provenance:"Avalanche bridged DAI"},
  {network:"arbitrum",address:"0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",symbol:"DAI",name:"Dai Stablecoin",decimals:18,provenance:"Arbitrum DAI"},
  {network:"optimism",address:"0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",symbol:"DAI",name:"Dai Stablecoin",decimals:18,provenance:"Optimism DAI"},
  {network:"base",address:"0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",symbol:"DAI",name:"Dai Stablecoin",decimals:18,provenance:"Base bridged DAI"},

  // Wrapped native / major ETH representations (18 decimals).
  {network:"ethereum",address:"0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",symbol:"WETH",name:"Wrapped Ether",decimals:18,provenance:"Canonical WETH9"},
  {network:"polygon",address:"0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",symbol:"WETH",name:"Wrapped Ether",decimals:18,provenance:"Polygon WETH"},
  {network:"bsc",address:"0x2170Ed0880ac9A755fd29B2688956BD959F933F8",symbol:"ETH",name:"Ethereum Token",decimals:18,provenance:"BNB Chain bridged ETH"},
  {network:"avalanche",address:"0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB",symbol:"WETH.e",name:"Wrapped Ether.e",decimals:18,provenance:"Avalanche bridged WETH.e"},
  {network:"arbitrum",address:"0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",symbol:"WETH",name:"Wrapped Ether",decimals:18,provenance:"Arbitrum canonical WETH"},
  {network:"optimism",address:"0x4200000000000000000000000000000000000006",symbol:"WETH",name:"Wrapped Ether",decimals:18,provenance:"Optimism canonical WETH"},
  {network:"base",address:"0x4200000000000000000000000000000000000006",symbol:"WETH",name:"Wrapped Ether",decimals:18,provenance:"Base canonical WETH"},
  {network:"bsc",address:"0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",symbol:"WBNB",name:"Wrapped BNB",decimals:18,provenance:"BNB Chain wrapped native token"},
  {network:"avalanche",address:"0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7",symbol:"WAVAX",name:"Wrapped AVAX",decimals:18,provenance:"Avalanche wrapped native token"},

  // Official Tether ERC-20 deployments in its published protocol guidance.
  {network:"ethereum",address:"0xdAC17F958D2ee523a2206206994597C13D831ec7",symbol:"USDT",name:"Tether USD",decimals:6,provenance:"Tether official ERC-20"},
  {network:"avalanche",address:"0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7",symbol:"USDT",name:"Tether USD",decimals:6,provenance:"Tether official Avalanche ERC-20"}
];
