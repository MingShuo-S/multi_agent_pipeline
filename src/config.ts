import { homedir } from 'os';
import { join } from 'path';

const { env } = process;

export const WORKSPACE_ROOT = env.OPENCLAW_WORKSPACE
  ? join(env.OPENCLAW_WORKSPACE)
  : join(homedir(), '.openclaw', 'workspaces', 'multi-agent-pipeline');
