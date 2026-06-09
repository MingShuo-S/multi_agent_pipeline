// src/config.ts - 工作区路径配置
// 用 __dirname 推导 WORKSPACE_ROOT = <plugin_root>/workspace/
// 相对 .openclaw 位置在部署时确定，不依赖 HOME 目录猜测

import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname, basename } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const { env } = process;

const pluginRoot = join(__dirname, '..');

let wsRoot = env.OPENCLAW_WORKSPACE
    ? join(env.OPENCLAW_WORKSPACE)
    : join(pluginRoot, 'workspace');

if (basename(wsRoot) === 'templates') {
    wsRoot = join(wsRoot, '..');
}

export const WORKSPACE_ROOT = wsRoot;

export const SEED_TEMPLATES_DIR = join(__dirname, '..', 'templates');

export const PROFILES_DIR = join(wsRoot, '_profiles');
export const KNOWLEDGE_DIR = join(wsRoot, 'knowledge');

/** @deprecated Use PROFILES_DIR instead */
export const SHARED_DIR = PROFILES_DIR;
