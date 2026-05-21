# OpenClaw 插件开发最佳实践指南

> 基于 OpenClaw 2026.5.18 官方文档总结

## 📋 目录

- [核心范式](#核心范式)
- [文件结构](#文件结构)
- [关键配置](#关键配置)
- [工具注册](#工具注册)
- [常见问题](#常见问题)
- [修复清单](#修复清单)

---

## 核心范式

### 1. 插件定义三要素

每个 OpenClaw 插件必须包含：

```
1. package.json        - npm 包元数据 + openclaw 扩展声明
2. openclaw.plugin.json - OpenClaw 插件清单（必需！）
3. src/index.ts        - 插件入口点（使用 SDK 定义）
```

### 2. 入口点标准模式

```typescript
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { Type } from '@sinclair/typebox';

export default definePluginEntry({
  id: 'my-plugin',
  name: 'My Plugin',
  description: 'Short description',
  
  configSchema: Type.Object({
    // 配置项定义
  }),
  
  register(api) {
    api.registerTool({
      name: 'my_tool',
      description: 'Tool description',
      parameters: Type.Object({
        param: Type.String()
      }),
      async execute(_id, params) {
        return {
          content: [{ type: 'text', text: 'result' }]
        };
      }
    });
  }
});
```

---

## 文件结构

### 标准插件目录结构

```
my-plugin/
├── package.json              # npm 包配置
├── openclaw.plugin.json      # OpenClaw 插件清单（必需）
├── tsconfig.json             # TypeScript 配置
├── src/
│   ├── index.ts              # 插件入口
│   ├── tools/                # 工具实现
│   ├── runtime/              # 运行时逻辑
│   └── types.ts              # 类型定义
├── dist/                     # 编译输出
├── SKILL.md                  # 技能文档（可选）
└── README.md
```

### 关键文件说明

#### package.json

```json
{
  "name": "@org/my-plugin",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  
  "dependencies": {
    "@sinclair/typebox": "^0.34.49"
  },
  "peerDependencies": {
    "openclaw": ">=2026.5.18"
  },
  
  "openclaw": {
    "extensions": ["./dist/index.js"],
    "compat": {
      "pluginApi": ">=2026.5.18",
      "minGatewayVersion": ">=2026.5.18"
    }
  }
}
```

**关键点：**
- ✅ `extensions` 指向编译后的 JS 文件
- ✅ `peerDependencies` 声明 openclaw 依赖
- ✅ `type: "module"` 使用 ESM 模块

#### openclaw.plugin.json

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "description": "Plugin description",
  "version": "1.0.0",
  
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {}
  },
  
  "contracts": {
    "tools": ["my_tool", "another_tool"]
  },
  
  "toolMetadata": {
    "my_tool": {
      "description": "Tool metadata"
    }
  },
  
  "activation": {
    "onStartup": false
  }
}
```

**关键点：**
- ✅ `contracts.tools` 必须与注册的工具名称完全匹配
- ✅ `configSchema` 必须是有效的 JSON Schema
- ✅ `toolMetadata` 提供工具的额外信息

---

## 关键配置

### 1. contracts 声明

**位置：** `openclaw.plugin.json`

```json
{
  "contracts": {
    "tools": ["pipeline_read", "pipeline_write_slot"],
    "providers": ["my-provider"],
    "channels": ["my-channel"]
  }
}
```

**作用：**
- 声明插件提供的工具、提供者、频道
- OpenClaw 在不加载插件代码的情况下就能发现这些能力
- 必须与 `api.registerTool()` 中注册的工具名称一致

### 2. 工具元数据

```json
{
  "toolMetadata": {
    "my_tool": {
      "description": "Tool description",
      "optional": true,
      "orchestratorOnly": false
    }
  }
}
```

### 3. 激活配置

```json
{
  "activation": {
    "onStartup": false,  // 是否在 Gateway 启动时激活
    "onCommand": ["my-command"],
    "onTool": ["my_tool"]
  }
}
```

---

## 工具注册

### 标准工具注册模式

```typescript
api.registerTool({
  name: 'my_tool',
  description: '工具描述',
  
  parameters: Type.Object({
    input: Type.String({ description: '输入参数' }),
    count: Type.Optional(Type.Number({ default: 10 }))
  }),
  
  async execute(_id, params) {
    try {
      // 1. 获取上下文
      const context = getContext();
      
      // 2. 执行业务逻辑
      const result = await doWork(params);
      
      // 3. 返回标准格式
      return {
        content: [{
          type: 'text',
          text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
        }]
      };
    } catch (err) {
      return {
        content: [{
          type: 'text',
          text: `错误: ${err instanceof Error ? err.message : String(err)}`
        }],
        isError: true
      };
    }
  }
});
```

### 工具参数定义

使用 TypeBox 定义参数：

```typescript
import { Type } from '@sinclair/typebox';

// 简单参数
parameters: Type.Object({
  name: Type.String({ description: '名称' }),
  age: Type.Number({ description: '年龄' })
})

// 可选参数
parameters: Type.Object({
  name: Type.String(),
  options: Type.Optional(Type.Object({
    verbose: Type.Boolean({ default: false })
  }))
})

// 联合类型
parameters: Type.Object({
  action: Type.Union([
    Type.Literal('read'),
    Type.Literal('write'),
    Type.Literal('delete')
  ])
})

// 数组
parameters: Type.Object({
  items: Type.Array(Type.String())
})

// Record
parameters: Type.Object({
  metadata: Type.Record(Type.String(), Type.Unknown())
})
```

### 工具返回格式

```typescript
// 成功返回
return {
  content: [{
    type: 'text',
    text: 'Result string'
  }]
};

// JSON 返回
return {
  content: [{
    type: 'text',
    text: JSON.stringify(result, null, 2)
  }]
};

// 错误返回
return {
  content: [{
    type: 'text',
    text: '错误: ...'
  }],
  isError: true
};
```

---

## 常见问题

### ❌ 错误 1：contracts 放在 package.json

**错误：**
```json
// package.json
{
  "openclaw": {
    "contracts": {
      "tools": ["my_tool"]
    }
  }
}
```

**正确：**
```json
// openclaw.plugin.json
{
  "contracts": {
    "tools": ["my_tool"]
  }
}
```

### ❌ 错误 2：手动定义 definePluginEntry

**错误：**
```typescript
function definePluginEntry(entry) {
  return entry;
}
```

**正确：**
```typescript
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';

export default definePluginEntry({
  // ...
});
```

### ❌ 错误 3：错误的导入路径

**错误：**
```typescript
import { definePluginEntry } from 'openclaw/plugin-sdk';
```

**正确：**
```typescript
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
```

### ❌ 错误 4：工具返回格式不标准

**错误：**
```typescript
return { content: 'Result' };
return { text: 'Result' };
return 'Result';
```

**正确：**
```typescript
return {
  content: [{
    type: 'text',
    text: 'Result'
  }]
};
```

### ❌ 错误 5：缺少类型定义

**错误：**
```typescript
async execute(_id, params: any) {
  // ...
}
```

**正确：**
```typescript
async execute(_id, params: { name: string; count?: number }) {
  // 或使用 TypeBox 推断
}
```

---

## 修复清单

### ✅ 已修复的问题

1. **package.json**
   - ✅ 移除了错误的 `contracts` 声明
   - ✅ 添加了 `peerDependencies`
   - ✅ 添加了 `types` 字段
   - ✅ 修正了 `openclaw.extensions` 路径

2. **openclaw.plugin.json**
   - ✅ 添加了 `contracts.tools` 声明
   - ✅ 添加了 `toolMetadata` 配置
   - ✅ 修正了 `activation.onStartup` 为 false

3. **src/index.ts**
   - ✅ 使用官方 `definePluginEntry`
   - ✅ 从正确的子路径导入 SDK
   - ✅ 标准化了工具返回格式
   - ✅ 添加了完整的错误处理
   - ✅ 使用 TypeBox 定义参数

### 📝 后续建议

1. **添加单元测试**
   ```bash
   npm install --save-dev vitest @vitest/ui
   ```

2. **添加 TypeScript 类型导出**
   ```typescript
   // src/types.ts
   export interface MyToolResult {
     success: boolean;
     data?: unknown;
     error?: string;
   }
   ```

3. **添加文档**
   - 每个工具添加详细的 description
   - 为复杂参数添加 examples
   - 编写使用示例

4. **性能优化**
   - 使用懒加载导入大型依赖
   - 缓存重复计算的结果
   - 避免在工具注册时执行重操作

---

## 最佳实践总结

### 1. 导入规范

✅ **推荐：**
```typescript
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { Type } from '@sinclair/typebox';
```

❌ **避免：**
```typescript
import { definePluginEntry } from 'openclaw/plugin-sdk'; // 根导入已废弃
```

### 2. 工具命名

✅ **推荐：**
- 使用 snake_case：`pipeline_read`, `style_get_profile`
- 语义清晰：`pipeline_start` 而不是 `start`
- 避免冲突：使用前缀 `my_plugin_tool`

### 3. 错误处理

✅ **推荐：**
```typescript
async execute(_id, params) {
  try {
    // 业务逻辑
    return { content: [{ type: 'text', text: 'Success' }] };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `错误: ${err.message}` }],
      isError: true
    };
  }
}
```

### 4. 配置管理

✅ **推荐：**
```typescript
configSchema: Type.Object({
  apiKey: Type.Optional(Type.String({ description: 'API密钥' })),
  timeout: Type.Optional(Type.Number({ default: 30000 }))
})
```

### 5. 文档注释

✅ **推荐：**
```typescript
/**
 * 启动一个多 Agent 管道项目
 * 
 * @param template_name - 管道模板名称（如 xiaohongshu-creation）
 * @param user_id - 用户 ID（如 alice）
 * @param project_id - 项目 ID（如 camping-post）
 * @returns 执行到第一个 checkpoint 的结果
 */
```

---

## 参考资源

- [OpenClaw 官方文档](https://docs.openclaw.ai)
- [插件开发指南](https://docs.openclaw.ai/plugins/building-plugins)
- [SDK 参考](https://docs.openclaw.ai/plugins/sdk-overview)
- [工具插件](https://docs.openclaw.ai/plugins/tool-plugins)
- [插件清单](https://docs.openclaw.ai/plugins/manifest)
