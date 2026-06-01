import os, shutil

base = '/root/multi_agent_pipeline'

def patch(path, old, new):
    full = os.path.join(base, path)
    with open(full, 'r', encoding='utf-8') as f:
        c = f.read()
    if old not in c:
        print(f'  FAIL {path}: old text not found')
        return False
    c = c.replace(old, new)
    with open(full, 'w', encoding='utf-8') as f:
        f.write(c)
    print(f'  OK {path}')
    return True

print('=== Patching TypeScript files ===')

# Fix 1: workspace-config.ts - add KNOWN_AGENTS
patch('src/tools/workspace-config.ts',
    "import { SEED_TEMPLATES_DIR } from '../config.js';",
    "import { SEED_TEMPLATES_DIR } from '../config.js';\n\nconst KNOWN_AGENTS = [\n  'topic-researcher',\n  'web-researcher',\n  'content-writer',\n  'quality-reviewer',\n  'publisher',\n];"
)

# Fix 1b: add agent name validation in writeTemplate
patch('src/tools/workspace-config.ts',
    '''  async writeTemplate(templateName: string, template: Template): Promise<void> {
    const templatePath = path.join(this.workspaceRoot, 'templates', `${templateName}.json`);
    try {
      // 校验 JSON 合法性
      const json = JSON.stringify(template, null, 2);
      JSON.parse(json);

      const dir = path.dirname(templatePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(templatePath, json, 'utf-8');
    } catch (err) {
      throw new Error(`Failed to write template: ${err}`);
    }
  }''',
    '''  async writeTemplate(templateName: string, template: Template): Promise<void> {
    const templatePath = path.join(this.workspaceRoot, 'templates', `${templateName}.json`);
    try {
      // 校验 JSON 合法性
      const json = JSON.stringify(template, null, 2);
      JSON.parse(json);

      // 校验 stages 中的 agent 名称
      if (template.stages && Array.isArray(template.stages)) {
        const invalidAgents = template.stages
          .map(s => s.agent)
          .filter(a => a && !KNOWN_AGENTS.includes(a));
        if (invalidAgents.length > 0) {
          throw new Error(
            `模板包含无效的 agent 名称: ${invalidAgents.join(', ')}。` +
            `可用 agent: ${KNOWN_AGENTS.join(', ')}`
          );
        }
      }

      const dir = path.dirname(templatePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(templatePath, json, 'utf-8');
    } catch (err) {
      throw new Error(`Failed to write template: ${err}`);
    }
  }'''
)

# Fix 2: pipeline.ts - resilient empty slot
patch('src/tools/pipeline.ts',
    '''  if (!(slotName in state.slot_values)) {
    throw new Error(`Slot '${slotName}' not found`);
  }

  return state.slot_values[slotName];''',
    '''  if (!(slotName in state.slot_values)) {
    return `（Slot '${slotName}' 尚无内容，请先等待前面的 Agent 完成。）`;
  }

  const value = state.slot_values[slotName];
  if (value === '' || value === null || value === undefined) {
    return `（Slot '${slotName}' 当前为空，暂无可用内容。）`;
  }

  return value;'''
)

# Fix 3: pipeline-continue.ts - advance signal detection
patch('src/tools/pipeline-continue.ts',
    '''function isAdvanceSignal(message: string): boolean {
  const trimmed = message.trim().toLowerCase();
  return ADVANCE_KEYWORDS.some(kw => {
    const kwLower = kw.toLowerCase();
    return trimmed === kwLower || trimmed.startsWith(kwLower + ' ') || trimmed.endsWith(' ' + kwLower);
  });
}''',
    '''function isAdvanceSignal(message: string): boolean {
  const trimmed = message.trim().toLowerCase();
  return ADVANCE_KEYWORDS.some(kw => {
    const kwLower = kw.toLowerCase();
    return trimmed === kwLower
      || trimmed.startsWith(kwLower + ' ')
      || trimmed.endsWith(' ' + kwLower)
      || trimmed.includes(kwLower + kwLower);
  });
}'''
)

print()
print('=== Building ===')
os.chdir(base)
r = os.system('npm run build 2>&1')
if r != 0:
    print('BUILD FAILED')
    exit(1)

print('=== BUILD OK ===')
print()
print('Now run: bash scripts/deploy.sh')
