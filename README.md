# multi-agent-pipeline 使用指南

这是 multi-agent-pipeline 插件的最终使用说明，覆盖安装、Dashboard 交互、Docker 中的 OpenClaw 部署和常见排查。

## 1. 快速开始

先在项目根目录构建：

```bash
npm install
npm run build
```

如果 OpenClaw 跑在宿主机上：

```bash
openclaw plugins install . --link
openclaw gateway restart
```

验证插件是否加载成功：

```bash
openclaw plugins list
openclaw plugins inspect multi-agent-pipeline --runtime --json
```

项目已添加 `prepare` 脚本，`npm install` 后会自动构建 `dist/`，确保 `dist/index.js` 可用。

## 2. Docker 中运行的 OpenClaw

你现在的 OpenClaw 运行在 Docker 容器里，常用进入方式是：

```bash
docker exec -it openclaw /bin/bash
```

你的宿主机 OpenClaw 数据目录是：

```text
C:\Users\29548\Desktop\Sunshine\Projects\Bu-Xia-Zuo\.openclaw\
```

### 2.1 你当前推荐的云端/容器内流程

按你给的流程，建议在容器内按以下顺序执行：

```bash
# 步骤 0：设置网络镜像
npm config set registry https://registry.npmmirror.com

# 步骤 1：从 Gitee/GitHub 镜像拉取插件代码
cd /root
git clone https://kkgithub.com/MingShuo-S/multi_agent_pipeline.git
cd multi_agent_pipeline

# 步骤 2：安装依赖并编译
rm -rf node_modules package-lock.json
npm install --include=dev
npm run build

# 步骤 3：注册插件到 OpenClaw
openclaw plugins install /root/multi_agent_pipeline --link

# 步骤 4：初始化工作区并创建默认模板
node dist/cli.js init
```

### 2.2 这套流程适合排查什么问题

这组命令最适合检查下面几类插件问题：

- 依赖安装是否完整，尤其是在 `NODE_ENV=production` 时 devDependencies 是否缺失
- `dist/index.js` 是否真的被编译出来
- OpenClaw 是否能从容器内的 `/root/multi_agent_pipeline` 正确加载插件
- `node dist/cli.js init` 是否能在容器里正确创建 `~/.openclaw/workspaces/multi-agent-pipeline/`

如果你怀疑插件没有注册成功，先按上面 0 到 4 步走一遍，再在容器内执行：

```bash
openclaw plugins list
openclaw plugins inspect multi-agent-pipeline --runtime --json
```

### 2.3 容器里的工作区路径

如果容器用户是 root，`node dist/cli.js init` 会把工作区初始化到：

```text
/root/.openclaw/workspaces/multi-agent-pipeline/
```

这和你宿主机挂载的 `.openclaw` 目录是一致思路，容器里主要看 `/root/.openclaw`。

### 2.4 我还可以继续帮你做的事

如果你愿意，我下一步可以直接帮你把这套流程整理成一个容器内的验证脚本，例如：

```bash
#!/usr/bin/env bash
set -euo pipefail
npm config set registry https://registry.npmmirror.com
cd /root/multi_agent_pipeline
rm -rf node_modules package-lock.json
npm install --include=dev
npm run build
openclaw plugins install /root/multi_agent_pipeline --link
node dist/cli.js init
openclaw plugins list
```

如果你要，我可以把这个脚本直接补到仓库里，作为你在容器中调试插件的标准入口。

## 3. Dashboard 上怎么交互

1. 在 Dashboard 或 orchestrator 中使用 `pipeline_start` 启动模板，例如 `xiaohongshu-creation`。
2. 系统执行到第一个 `checkpoint` 时，会把产出展示到 Dashboard。
3. 你可以在 Dashboard 里直接修改模板、补充 `remark`，或者输入 `agree` 继续。
4. 如果要把修改意见送回子 Agent，orchestrator 会调用 `route_message`。

常用工具：

- `pipeline_start(template_name, user_id, project_id)`
- `pipeline_read(slot_name)`
- `pipeline_write_slot(slot_name, content)`
- `pipeline_add_remark(content)`
- `workspace_config(action, ...)`

## 4. 常用命令

```bash
npm run build
node dist/cli.js start xiaohongshu-creation --user=alice --project=my-post
openclaw plugins list
openclaw plugins inspect multi-agent-pipeline --runtime --json
```

## 5. Tool 注册失败的排查顺序

1. 确认 `dist/index.js` 已生成。

```bash
npm install
npm run build
```

2. 确认 `openclaw.plugin.json` 的 `contracts.tools` 与 `src/index.ts` 里 `api.registerTool({ name: '...' })` 完全一致。

3. 确认 `package.json` 里的 `openclaw.extensions` 指向 `./dist/index.js`。

4. 在容器里看日志。

```bash
docker exec -it openclaw /bin/bash
openclaw gateway logs --tail 200
```

如果容器里没有这个命令，就在宿主机看容器日志：

```bash
docker logs openclaw --tail 200
```

5. 确认容器内 Node 版本与 `package.json.engines` 一致，并且没有 ESM / CJS 混用问题。

## 6. 当前项目状态

- 根目录只保留两份主文档：`README.md` 和 `ARCHITECTURE.md`
- 其他历史文档已归档到 `docs/archive/`
- `package.json` 已添加 `prepare` 脚本
- 已静态确认工具注册名与 `openclaw.plugin.json` 一致