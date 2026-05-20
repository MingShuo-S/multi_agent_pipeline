import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import * as fs from "node:fs/promises";
import * as path from "node:path";

// ===== 辅助函数（实现管道文件的读写） =====

function resolveOpenclawHome() {
  if (process.env.OPENCLAW_HOME) {
    return process.env.OPENCLAW_HOME;
  }
  const userHome = process.env.HOME || process.env.USERPROFILE;
  if (!userHome) {
    throw new Error("OPENCLAW_HOME or HOME/USERPROFILE must be set.");
  }
  return path.join(userHome, ".openclaw");
}

const PIPELINE_ROOT = path.join(resolveOpenclawHome(), "pipeline");

function isEnoent(error) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (isEnoent(error)) {
      return false;
    }
    throw error;
  }
}

async function readJsonFile(filePath) {
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw);
}

async function writeJsonFile(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function pipelineFilePath(projectId) {
  return path.join(PIPELINE_ROOT, "projects", projectId, "pipeline.json");
}

function profileFilePath(userId, agentId) {
  return path.join(PIPELINE_ROOT, "users", userId, "agents", agentId, "profile.json");
}

function createBaseProfile(userId, agentId) {
  return {
    agent_id: agentId,
    owner: userId,
    rules: [],
    samples: [],
    stats: {
      total_tasks: 0,
      positive_feedback: 0,
      negative_feedback: 0,
    },
  };
}

async function readPipelineFile(projectId) {
  return readJsonFile(pipelineFilePath(projectId));
}

async function writePipelineFile(projectId, data) {
  await writeJsonFile(pipelineFilePath(projectId), data);
}

async function readProfileFile(userId, agentId) {
  const filePath = profileFilePath(userId, agentId);
  if (!(await fileExists(filePath))) {
    const profile = createBaseProfile(userId, agentId);
    await writeJsonFile(filePath, profile);
    return profile;
  }
  return readJsonFile(filePath);
}

async function writeSlot(projectId, slotName, value, writtenBy) {
  const pipeline = await readPipelineFile(projectId);
  const slot = pipeline.slots?.[slotName];
  if (slot && slot.owner && slot.owner !== writtenBy) {
    return false; // 只有 slot owner 可以写入
  }
  pipeline.slots = pipeline.slots || {};
  pipeline.slots[slotName] = {
    value,
    owner: writtenBy,
    written_by: writtenBy,
    written_at: new Date().toISOString(),
    remarks: slot?.remarks || [],
  };
  await writePipelineFile(projectId, pipeline);
  return true;
}

async function addRemark(projectId, slotName, remark) {
  const pipeline = await readPipelineFile(projectId);
  const slot = pipeline.slots?.[slotName];
  if (!slot) return false;
  slot.remarks = slot.remarks || [];
  slot.remarks.push({
    id: `r${Date.now()}`,
    from: remark.from,
    type: remark.type,
    text: remark.text,
    priority: remark.priority || "normal",
    resolved: false,
    created_at: new Date().toISOString(),
  });
  await writePipelineFile(projectId, pipeline);
  return true;
}

async function appendExecutionLog(projectId, agentId, entry) {
  const pipeline = await readPipelineFile(projectId);
  const logEntry = {
    id: `e${Date.now()}`,
    agent_id: agentId,
    entry,
    created_at: new Date().toISOString(),
  };
  pipeline.append_log = pipeline.append_log || [];
  pipeline.append_log.push(logEntry);
  await writePipelineFile(projectId, pipeline);
  return logEntry;
}

async function readExecutionLog(projectId, agentId, limit) {
  const pipeline = await readPipelineFile(projectId);
  const logs = Array.isArray(pipeline.append_log) ? pipeline.append_log : [];
  const filtered = logs.filter((log) => log?.agent_id === agentId);
  if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) {
    return filtered.slice(-limit);
  }
  return filtered;
}

function adjustRules(rules, delta) {
  const now = new Date().toISOString();
  return rules.map((rule) => {
    if (!rule || typeof rule !== "object") {
      return rule;
    }
    const updated = { ...rule };
    const current = typeof updated.confidence === "number" ? updated.confidence : 0.5;
    const next = Math.max(0, Number((current + delta).toFixed(2)));
    updated.confidence = next;
    if (next < 0.1) {
      updated.disabled = true;
      updated.disabled_at = now;
    } else if (updated.disabled) {
      updated.disabled = false;
      delete updated.disabled_at;
    }
    return updated;
  });
}

function addSample(samples, feedback, content, note) {
  const sample = {
    id: `s${Date.now()}`,
    type: feedback,
    created_at: new Date().toISOString(),
  };
  if (content !== undefined) {
    sample.content = content;
  }
  if (note !== undefined) {
    sample.note = note;
  }
  return [...samples, sample];
}

const schemaPipelineRead = {
  type: "object",
  properties: {
    project_id: { type: "string", description: "项目 ID（如 proj_20260519_001）" },
  },
  required: ["project_id"],
};

const schemaPipelineWriteSlot = {
  type: "object",
  properties: {
    project_id: { type: "string", description: "项目 ID" },
    slot_name: { type: "string", description: "Slot 名称（如 topic_output、draft_output）" },
    value: { description: "要写入的数据（可以是字符串、对象、数组等任意 JSON）" },
    written_by: { type: "string", description: "写入者的 agent id（如 topic-researcher）" },
  },
  required: ["project_id", "slot_name", "value", "written_by"],
};

const schemaPipelineAddRemark = {
  type: "object",
  properties: {
    project_id: { type: "string", description: "项目 ID" },
    slot_name: { type: "string", description: "目标 Slot 名称" },
    type: {
      type: "string",
      enum: ["warning", "suggest", "question"],
      description:
        "remark 类型：warning=发现问题必须注意, suggest=优化建议, question=向 slot owner 提问",
    },
    text: { type: "string", description: "remark 正文" },
    from: { type: "string", description: "添加者的 agent id" },
    priority: {
      type: "string",
      enum: ["high", "normal", "low"],
      description: "优先级（默认 normal）",
    },
  },
  required: ["project_id", "slot_name", "type", "text", "from"],
};

const schemaStyleGetProfile = {
  type: "object",
  properties: {
    user_id: { type: "string", description: "用户 ID（如 u001）" },
    agent_id: { type: "string", description: "Agent ID（如 content-writer）" },
  },
  required: ["user_id", "agent_id"],
};

const schemaStyleRecordFeedback = {
  type: "object",
  properties: {
    user_id: { type: "string", description: "用户 ID" },
    agent_id: { type: "string", description: "Agent ID" },
    feedback: {
      type: "string",
      enum: ["positive", "negative"],
      description: "反馈类型：positive=正面，negative=负面",
    },
    content: { type: "string", description: "可选：反馈内容或样本文本" },
    note: { type: "string", description: "可选：补充说明" },
  },
  required: ["user_id", "agent_id", "feedback"],
};

const schemaExecutionLogAppend = {
  type: "object",
  properties: {
    project_id: { type: "string", description: "项目 ID" },
    agent_id: { type: "string", description: "Agent ID" },
    entry: { description: "执行记录内容（任意 JSON）" },
  },
  required: ["project_id", "agent_id", "entry"],
};

const schemaExecutionLogRead = {
  type: "object",
  properties: {
    project_id: { type: "string", description: "项目 ID" },
    agent_id: { type: "string", description: "Agent ID（用于过滤日志）" },
    limit: { type: "number", description: "可选：最多返回条数（从最新开始）" },
  },
  required: ["project_id", "agent_id"],
};

// ===== 插件入口 =====

export default definePluginEntry({
  id: "multi-agent-pipeline",
  name: "通用多 Agent 流水线引擎",
  description: "Slot 所有权 + Remark 追溯 + 用户级进化记忆，支持多 Agent 协作流水线",

  register(api) {
    // Tool 1: pipeline_read — 读取管道状态
    api.registerTool({
      name: "pipeline_read",
      description:
        "读取指定项目的完整管道状态，包括当前 stage、所有 slots 的数据和 remarks、以及 append_log。在执行任何 stage 前必须调用此工具获取最新状态。",
      parameters: schemaPipelineRead,
      async execute(_id, params) {
        const data = await readPipelineFile(params.project_id);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      },
    });

    // Tool 2: pipeline_write_slot — 写入 Slot（只有 owner 可写）
    api.registerTool({
      name: "pipeline_write_slot",
      description:
        "向指定 slot 写入数据。重要：只有该 slot 的 owner 才能写入。写入前会校验 ownership，非 owner 写入会被拒绝。写入后自动更新 written_at 时间戳。",
      parameters: schemaPipelineWriteSlot,
      async execute(_id, params) {
        const ok = await writeSlot(
          params.project_id,
          params.slot_name,
          params.value,
          params.written_by
        );
        return {
          content: [
            {
              type: "text",
              text: ok
                ? `Slot "${params.slot_name}" 写入成功`
                : `写入失败：Slot "${params.slot_name}" 的 owner 不是 "${params.written_by}"，无权修改。请使用 pipeline_add_remark 添加批注。`,
            },
          ],
        };
      },
    });

    // Tool 3: pipeline_add_remark — 添加 Remark（非 owner 的建议/警告/提问）
    api.registerTool({
      name: "pipeline_add_remark",
      description:
        "向指定 slot 添加 remark（批注）。当某个 Agent 发现其他 Agent 的产出有问题时，不应直接修改 slot，而应使用此工具添加批注。后续 Agent 读取 slot 时会看到所有 remarks 并据此调整行为。",
      parameters: schemaPipelineAddRemark,
      async execute(_id, params) {
        await addRemark(params.project_id, params.slot_name, {
          type: params.type,
          text: params.text,
          from: params.from,
          priority: params.priority,
        });
        return {
          content: [
            {
              type: "text",
              text: `Remark 已添加到 slot "${params.slot_name}"（类型: ${params.type}，来自: ${params.from}）`,
            },
          ],
        };
      },
    });

    // Tool 4: style_get_profile — 读取进化记忆
    api.registerTool({
      name: "style_get_profile",
      description:
        "读取指定用户与 Agent 的进化记忆 profile.json，用于风格、偏好与规则的持久化加载。",
      parameters: schemaStyleGetProfile,
      async execute(_id, params) {
        const data = await readProfileFile(params.user_id, params.agent_id);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      },
    });

    // Tool 5: style_record_feedback — 记录反馈并调整规则置信度
    api.registerTool({
      name: "style_record_feedback",
      description:
        "记录用户反馈，更新 profile.json 的 rules/samples/stats，并按正负反馈调整规则置信度。",
      parameters: schemaStyleRecordFeedback,
      async execute(_id, params) {
        const profile = await readProfileFile(params.user_id, params.agent_id);
        const profileObj =
          typeof profile === "object" && profile !== null ? profile : {};

        const delta = params.feedback === "positive" ? 0.1 : -0.2;
        const rules = Array.isArray(profileObj.rules) ? profileObj.rules : [];
        const samples = Array.isArray(profileObj.samples) ? profileObj.samples : [];
        const stats =
          typeof profileObj.stats === "object" && profileObj.stats !== null
            ? profileObj.stats
            : {};

        const totalTasks = typeof stats.total_tasks === "number" ? stats.total_tasks : 0;
        const positiveFeedback =
          typeof stats.positive_feedback === "number" ? stats.positive_feedback : 0;
        const negativeFeedback =
          typeof stats.negative_feedback === "number" ? stats.negative_feedback : 0;

        profileObj.agent_id = params.agent_id;
        profileObj.owner = params.user_id;
        profileObj.rules = adjustRules(rules, delta);
        profileObj.samples = addSample(samples, params.feedback, params.content, params.note);
        profileObj.stats = {
          total_tasks: totalTasks + 1,
          positive_feedback: positiveFeedback + (params.feedback === "positive" ? 1 : 0),
          negative_feedback: negativeFeedback + (params.feedback === "negative" ? 1 : 0),
        };

        await writeJsonFile(profileFilePath(params.user_id, params.agent_id), profileObj);
        return {
          content: [
            {
              type: "text",
              text: `反馈已记录（${params.feedback}），profile.json 已更新。`,
            },
          ],
        };
      },
    });

    // Tool 6: execution_log_append — 追加执行记录
    api.registerTool({
      name: "execution_log_append",
      description:
        "向指定项目追加执行记录，用于子 Agent 启动时快速回溯当前项目上下文。",
      parameters: schemaExecutionLogAppend,
      async execute(_id, params) {
        const logEntry = await appendExecutionLog(
          params.project_id,
          params.agent_id,
          params.entry
        );
        return {
          content: [
            {
              type: "text",
              text: `执行记录已追加（id: ${logEntry.id}）。`,
            },
          ],
        };
      },
    });

    // Tool 7: execution_log_read — 读取执行记录
    api.registerTool({
      name: "execution_log_read",
      description: "读取指定项目的执行记录，用于子 Agent 获取当前项目上下文。",
      parameters: schemaExecutionLogRead,
      async execute(_id, params) {
        const logs = await readExecutionLog(
          params.project_id,
          params.agent_id,
          params.limit
        );
        return { content: [{ type: "text", text: JSON.stringify(logs, null, 2) }] };
      },
    });
  },
});
