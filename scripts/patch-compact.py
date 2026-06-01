import os
b='/root/multi_agent_pipeline'
def p(path,o,n):
 f=os.path.join(b,path)
 with open(f) as f2: c=f2.read()
 c=c.replace(o,n)
 with open(f,'w') as f2: f2.write(c)
 print('OK',path)
p('src/tools/workspace-config.ts',
 "import { SEED_TEMPLATES_DIR } from '../config.js';",
 "import { SEED_TEMPLATES_DIR } from '../config.js';\n\nconst KNOWN_AGENTS = [\n  'topic-researcher',\n  'web-researcher',\n  'content-writer',\n  'quality-reviewer',\n  'publisher',\n];")
p('src/tools/workspace-config.ts',
 "const json = JSON.stringify(template, null, 2);\n      JSON.parse(json);\n\n      const dir",
 "const json = JSON.stringify(template, null, 2);\n      JSON.parse(json);\n\n      if (template.stages && Array.isArray(template.stages)) {\n        const invalidAgents = template.stages.map(s=>s.agent).filter(a=>a&&!KNOWN_AGENTS.includes(a));\n        if (invalidAgents.length > 0) throw new Error(`invalid agents: ${invalidAgents.join(', ')}.可用: ${KNOWN_AGENTS.join(', ')}`);\n      }\n\n      const dir")
p('src/tools/pipeline.ts',
 "if (!(slotName in state.slot_values)) {\n    throw new Error(`Slot '${slotName}' not found`);\n  }\n\n  return state.slot_values[slotName];",
 "if (!(slotName in state.slot_values)) {\n    return `（Slot '${slotName}' 尚无内容）`;\n  }\n  const value = state.slot_values[slotName];\n  if (value === '' || value === null || value === undefined) {\n    return `（Slot '${slotName}' 当前为空）`;\n  }\n  return value;")
p('src/tools/pipeline-continue.ts',
 "return trimmed === kwLower || trimmed.startsWith(kwLower + ' ') || trimmed.endsWith(' ' + kwLower);",
 "return trimmed === kwLower\n      || trimmed.startsWith(kwLower + ' ')\n      || trimmed.endsWith(' ' + kwLower)\n      || trimmed.includes(kwLower + kwLower);")
print('All patches applied')
print('Now building...')
os.chdir(b)
os.system('npm run build 2>&1')
