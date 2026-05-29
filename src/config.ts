import { homedir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const { env } = process;

export const WORKSPACE_ROOT = env.OPENCLAW_WORKSPACE
  ? join(env.OPENCLAW_WORKSPACE)
  : join(homedir(), '.openclaw', 'workspaces', 'multi-agent-pipeline');

export const SEED_TEMPLATES_DIR = join(__dirname, '..', 'templates');
