# 插件安装与验证指南

## ✅ 编译成功确认

插件已成功编译，所有 20 个 TypeScript 错误已修复：

```
✅ 生成 56 个文件
✅ 插件入口: dist/index.js (12.7 KB)
✅ 类型声明: dist/index.d.ts (1.6 KB)
✅ 无编译错误
```

---

## 🚀 安装步骤

### 步骤 1: 进入插件目录

```powershell
cd C:\Users\29548\Desktop\Sunshine\Projects\multi_agent_pipeline
```

### 步骤 2: 安装依赖（如果还没安装）

```powershell
npm install
```

### 步骤 3: 验证编译

```powershell
npm run build
# 应该看到: > tsc
# 无错误输出
```

### 步骤 4: 安装插件（开发模式）

```powershell
openclaw plugins install . --link
```

**预期输出**:
```
✓ Plugin installed: multi-agent-pipeline
  - Source: linked (development mode)
  - Path: C:\Users\29548\Desktop\Sunshine\Projects\multi_agent_pipeline
```

### 步骤 5: 重启 Gateway

```powershell
openclaw gateway restart
```

**预期输出**:
```
Gateway restarted successfully
```

### 步骤 6: 验证插件加载

```powershell
openclaw plugins list
```

**预期输出**:
```
ID                      Status      Version
multi-agent-pipeline    active      0.1.0
```

### 步骤 7: 检查工具注册

```powershell
openclaw plugins inspect multi-agent-pipeline --runtime --json
```

**预期输出** (JSON 格式):
```json
{
  "id": "multi-agent-pipeline",
  "name": "通用多 Agent 流水线引擎",
  "status": "active",
  "tools": [
    { "name": "pipeline_read", ... },
    { "name": "pipeline_write_slot", ... },
    { "name": "pipeline_add_remark", ... },
    ...
  ]
}
```

---

## 🧪 功能测试

### 测试 1: 启动管道

在 OpenClaw 对话中输入：

```
使用 pipeline_start 工具启动一个小红书创作管道：
- 模板: xiaohongshu-creation
- 用户: test-user
- 项目: test-project
```

**预期结果**:
```
✅ 管道已启动
当前阶段: 需求分析
状态: checkpoint_reached
```

### 测试 2: 读取 Slot

```
使用 pipeline_read 读取 topic slot
```

**预期结果**:
```
Slot 内容: [小红书笔记主题]
```

### 测试 3: 写入 Slot

```
使用 pipeline_write_slot 写入 content slot:
"这是一篇测试内容"
```

**预期结果**:
```
✅ 写入成功
```

### 测试 4: 添加批注

```
使用 pipeline_add_remark 添加批注:
"请优化标题，使其更具吸引力"
```

**预期结果**:
```
✅ 批注已添加
```

### 测试 5: 继续管道

```
使用 pipeline_continue 继续，用户 test-user，项目 test-project，反馈: agree
```

**预期结果**:
```
✅ 管道已推进到下一阶段
```

---

## 🔍 故障排查

### 问题 1: 插件未出现在列表中

**原因**: Gateway 未重启或安装失败

**解决方案**:
```powershell
# 重新安装
openclaw plugins uninstall multi-agent-pipeline
openclaw plugins install . --link

# 重启 Gateway
openclaw gateway restart
```

### 问题 2: 工具无法调用

**原因**: 工具注册失败或运行时错误

**解决方案**:
```powershell
# 检查运行时状态
openclaw plugins inspect multi-agent-pipeline --runtime --json

# 查看 Gateway 日志
openclaw gateway logs --tail 100
```

### 问题 3: 编译错误

**原因**: TypeScript 配置或依赖问题

**解决方案**:
```powershell
# 清理并重新安装依赖
rm -r node_modules
npm install

# 重新编译
npm run build
```

### 问题 4: 权限错误

**原因**: OpenClaw 数据目录权限不足

**解决方案**:
```powershell
# 检查数据目录权限
ls ~/.openclaw

# 如果不存在，创建目录
mkdir -p ~/.openclaw/workspaces/multi-agent-pipeline
```

---

## 📊 验证清单

### 编译验证

- [x] TypeScript 编译无错误
- [x] 生成 dist/index.js
- [x] 生成 dist/index.d.ts
- [x] 生成所有工具文件

### 安装验证

- [ ] 插件出现在 `openclaw plugins list`
- [ ] 插件状态为 `active`
- [ ] 版本号正确 (0.1.0)

### 运行时验证

- [ ] `openclaw plugins inspect` 显示 10 个工具
- [ ] 工具名称与 openclaw.plugin.json 中声明的一致
- [ ] 工具可以被调用

### 功能验证

- [ ] pipeline_start 正常工作
- [ ] pipeline_read 正常工作
- [ ] pipeline_write_slot 正常工作
- [ ] pipeline_add_remark 正常工作
- [ ] pipeline_continue 正常工作

---

## 📝 快速参考

### 常用命令

```powershell
# 编译
npm run build

# 安装插件
openclaw plugins install . --link

# 卸载插件
openclaw plugins uninstall multi-agent-pipeline

# 查看插件列表
openclaw plugins list

# 查看插件详情
openclaw plugins inspect multi-agent-pipeline

# 重启 Gateway
openclaw gateway restart

# 查看 Gateway 日志
openclaw gateway logs --tail 100

# 运行验证脚本
node verify-plugin.mjs
```

### 工具列表

1. `pipeline_read` - 读取 Slot
2. `pipeline_write_slot` - 写入 Slot
3. `pipeline_add_remark` - 添加批注
4. `style_get_profile` - 获取用户偏好
5. `style_record_feedback` - 记录用户反馈
6. `route_message` - 路由消息
7. `workspace_config` - 配置管理
8. `agent_guide_generator` - 生成 Agent 指南
9. `pipeline_start` - 启动管道
10. `pipeline_continue` - 继续管道

---

## 🎯 下一步

1. **完成验证清单** - 按照上面的清单逐项验证
2. **测试完整流程** - 启动一个完整的管道项目
3. **编写文档** - 为每个工具添加详细的使用文档
4. **添加测试** - 编写单元测试和集成测试
5. **优化性能** - 识别并优化性能瓶颈

---

**文档创建时间**: 2026-05-21 11:52 GMT+8  
**状态**: ✅ 编译成功，等待安装验证  
**预期状态**: 插件激活，所有工具可用
