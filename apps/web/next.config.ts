import { existsSync } from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * The workspace keeps one .env at its root — `.env.example` documents it and
 * the orchestrator reads it directly — but Next only loads env files from the
 * app directory. Without this the replay routes answer 501 even though the key
 * is sitting two directories up, which reads as a broken feed rather than a
 * missing key. Loading it here beats keeping a second copy of the secret.
 */
const rootEnv = path.resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const nextConfig: NextConfig = {
  transpilePackages: ['@aftershock/schema'],
  typedRoutes: false,
};

export default nextConfig;
