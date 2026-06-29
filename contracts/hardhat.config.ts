import { HardhatUserConfig, subtask } from 'hardhat/config';
import { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } from 'hardhat/builtin-tasks/task-names';
import '@nomicfoundation/hardhat-toolbox';
import * as dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

const PRIVATE_KEY = process.env.BLOCKCHAIN_PRIVATE_KEY || '0x' + '0'.repeat(64);
const POLYGONSCAN_API_KEY = process.env.POLYGONSCAN_API_KEY || '';

const SOLC_VERSION = '0.8.20';
const SOLC_LONG_VERSION = '0.8.20+commit.a1b79de6';

/**
 * Best-effort offline compiler resolution.
 *
 * Hardhat normally downloads solc from binaries.soliditylang.org. In
 * restricted/CI networks that host can be unreachable (TLS hangs → HH502).
 * If a matching `solc` npm package is installed locally we hand its bundled
 * soljson.js to Hardhat directly, avoiding the network entirely.
 *
 * This is purely additive: when `solc` is NOT installed, or its version does
 * not match, we fall through to Hardhat's normal downloader — so default
 * setups keep working unchanged. To enable the offline path:
 *   npm install --no-save solc@0.8.20
 * Docs: https://hardhat.org/hardhat-runner/docs/advanced/hardhat-runtime-environment
 */
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, _hre, runSuper) => {
  if (args.solcVersion === SOLC_VERSION) {
    try {
      const compilerPath = require.resolve('solc/soljson.js');
      const localVersion = require('solc/package.json').version as string;
      if (localVersion === SOLC_VERSION) {
        return {
          compilerPath,
          isSolcJs: true,
          version: SOLC_VERSION,
          longVersion: SOLC_LONG_VERSION,
        };
      }
    } catch {
      // `solc` not installed locally — use Hardhat's default downloader.
    }
  }
  return runSuper();
});

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.20',
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
