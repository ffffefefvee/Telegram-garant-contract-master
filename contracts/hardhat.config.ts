import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import * as dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

const PRIVATE_KEY = process.env.BLOCKCHAIN_PRIVATE_KEY || '0x' + '0'.repeat(64);
const POLYGONSCAN_API_KEY = process.env.POLYGONSCAN_API_KEY || '';

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: false,
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    localhost: {
      url: 'http://127.0.0.1:8545',
    },
    amoy: {
      url: process.env.BLOCKCHAIN_RPC_URL || 'https://polygon-amoy-bor-rpc.publicnode.com',
      chainId: 80002,
      accounts: [PRIVATE_KEY],
    },
    polygon: {
      url: 'https://polygon-rpc.com',
      chainId: 137,
      accounts: [PRIVATE_KEY],
    },
  },
  etherscan: {
    apiKey: {
      polygonAmoy: POLYGONSCAN_API_KEY,
      polygon: POLYGONSCAN_API_KEY,
    },
    customChains: [
      {
        network: 'polygonAmoy',
        chainId: 80002,
        urls: {
          apiURL: 'https://api-amoy.polygonscan.com/api',
          browserURL: 'https://amoy.polygonscan.com',
        },
      },
    ],
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === 'true',
    currency: 'USD',
  },
};

export default config;
