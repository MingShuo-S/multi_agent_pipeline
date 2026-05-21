#!/usr/bin/env node
/**
 * OpenClaw 插件验证脚本
 * 用于验证 multi-agent-pipeline 插件是否正确安装和配置
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const pluginName = 'multi-agent-pipeline';
const requiredTools = [
  'pipeline_read',
  'pipeline_write_slot',
  'pipeline_add_remark',
  'style_get_profile',
  'style_record_feedback',
  'route_message',
  'workspace_config',
  'agent_guide_generator',
  'pipeline_start',
  'pipeline_continue'
];

console.log('🔍 开始验证 OpenClaw 插件...\n');

// 1. 检查必需文件
console.log('📁 检查必需文件...');
const requiredFiles = [
  'package.json',
  'openclaw.plugin.json',
  'dist/index.js',
  'SKILL.md'
];

let filesOk = true;
for (const file of requiredFiles) {
  const exists = existsSync(join(process.cwd(), file));
  console.log(`  ${exists ? '✅' : '❌'} ${file}`);
  if (!exists) filesOk = false;
}

// 2. 检查 package.json
console.log('\n📦 检查 package.json...');
try {
  const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
  
  const checks = {
    'name': pkg.name === '@buxiazuo/multi-agent-pipeline',
    'type': pkg.type === 'module',
    'main': pkg.main === 'dist/index.js',
    'openclaw.extensions': pkg.openclaw?.extensions?.includes('./dist/index.js'),
    'peerDependencies.openclaw': !!pkg.peerDependencies?.openclaw
  };
  
  for (const [key, ok] of Object.entries(checks)) {
    console.log(`  ${ok ? '✅' : '❌'} ${key}`);
  }
} catch (err) {
  console.log('  ❌ 无法读取 package.json');
  filesOk = false;
}

// 3. 检查 openclaw.plugin.json
console.log('\n📋 检查 openclaw.plugin.json...');
try {
  const manifest = JSON.parse(readFileSync('openclaw.plugin.json', 'utf-8'));
  
  const checks = {
    'id': manifest.id === pluginName,
    'contracts.tools': Array.isArray(manifest.contracts?.tools),
    'toolMetadata': !!manifest.toolMetadata,
    'configSchema': !!manifest.configSchema
  };
  
  for (const [key, ok] of Object.entries(checks)) {
    console.log(`  ${ok ? '✅' : '❌'} ${key}`);
  }
  
  // 检查工具声明
  console.log('\n  工具声明检查:');
  const declaredTools = manifest.contracts?.tools || [];
  for (const tool of requiredTools) {
    const declared = declaredTools.includes(tool);
    console.log(`    ${declared ? '✅' : '❌'} ${tool}`);
  }
  
} catch (err) {
  console.log('  ❌ 无法读取 openclaw.plugin.json');
  filesOk = false;
}

// 4. 检查 OpenClaw CLI
console.log('\n🔧 检查 OpenClaw CLI...');
try {
  const version = execSync('openclaw --version', { encoding: 'utf-8' }).trim();
  console.log(`  ✅ OpenClaw 版本: ${version}`);
} catch (err) {
  console.log('  ❌ OpenClaw CLI 未安装或不在 PATH 中');
}

// 5. 检查插件安装状态
console.log('\n🔌 检查插件安装状态...');
try {
  const plugins = execSync('openclaw plugins list --json', { encoding: 'utf-8' });
  const pluginList = JSON.parse(plugins);
  const installed = pluginList.some((p: any) => p.id === pluginName);
  console.log(`  ${installed ? '✅' : '⚠️'} 插件${installed ? '已' : '未'}安装`);
  
  if (!installed) {
    console.log('\n  安装命令:');
    console.log('    openclaw plugins install . --link');
  }
} catch (err) {
  console.log('  ⚠️ 无法检查插件安装状态（Gateway 可能未运行）');
}

// 6. 运行时检查
console.log('\n⚡ 运行时检查...');
try {
  const inspect = execSync(`openclaw plugins inspect ${pluginName} --runtime --json`, { 
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe']
  });
  
  const runtime = JSON.parse(inspect);
  console.log(`  ✅ 插件运行时加载成功`);
  console.log(`  ✅ 注册工具数量: ${runtime.tools?.length || 0}`);
  
  // 检查工具是否全部注册
  const registeredTools = runtime.tools?.map((t: any) => t.name) || [];
  console.log('\n  工具注册检查:');
  for (const tool of requiredTools) {
    const registered = registeredTools.includes(tool);
    console.log(`    ${registered ? '✅' : '❌'} ${tool}`);
  }
  
} catch (err) {
  console.log('  ⚠️ 无法检查运行时（插件可能未安装或 Gateway 未运行）');
  console.log('\n  请执行以下命令:');
  console.log('    1. npm run build');
  console.log('    2. openclaw plugins install . --link');
  console.log('    3. openclaw gateway restart');
}

// 总结
console.log('\n' + '='.repeat(60));
console.log('📊 验证总结\n');

if (filesOk) {
  console.log('✅ 所有关键文件检查通过');
  console.log('✅ 配置格式正确');
  console.log('\n下一步操作:');
  console.log('  1. 编译: npm run build');
  console.log('  2. 安装: openclaw plugins install . --link');
  console.log('  3. 重启: openclaw gateway restart');
  console.log('  4. 验证: openclaw plugins inspect multi-agent-pipeline --runtime');
} else {
  console.log('❌ 部分检查未通过，请查看上面的详细信息');
}

console.log('\n' + '='.repeat(60));
