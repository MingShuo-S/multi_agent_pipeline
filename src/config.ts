import { homedir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname, basename } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const { env } = process;

let wsRoot = env.OPENCLAW_WORKSPACE
    ? join(env.OPENCLAW_WORKSPACE)
    : join(homedir(), '.openclaw', 'workspaces', 'multi-agent-pipeline');

// 如果 WORKSPACE_ROOT 的 basename 是 templates，说明网关传递的是模板目录而非工作区根目录
// 回退到父目录，避免代码逻辑中 path.join(WORKSPACE_ROOT, 'templates') 产生双嵌套路径
if (basename(wsRoot) === 'templates') {
    wsRoot = join(wsRoot, '..');
}

export const WORKSPACE_ROOT = wsRoot;

export const SEED_TEMPLATES_DIR = join(__dirname, '..', 'templates');
