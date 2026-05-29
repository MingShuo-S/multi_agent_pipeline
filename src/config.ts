import { homedir } from 'os';
import { join } from 'path';

export const WORKSPACE_ROOT = join(homedir(), '.openclaw', 'workspaces', 'multi-agent-pipeline');
