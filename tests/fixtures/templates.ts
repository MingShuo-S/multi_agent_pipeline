import type {
  Template, PipelineState, ToolContext, PipelineStage, PipelineRemark,
  SlotHistoryEntry, StageHistoryEntry, AgentProfile, Profile, AgentRole,
  PipelineMode,
} from '../../src/types.js';

export const WR = 'C:/workspace';
export const UID = 'user-1';
export const PID = 'project-1';

export const simpleTemplate2Stage: Template = {
  name: 'simple-2stage',
  description: '2-stage test: non-checkpoint → checkpoint',
  stages: [
    { id: 'research', agent: 'researcher', checkpoint: false, allow_read: ['*'], allow_write: ['topic'] },
    { id: 'write', agent: 'writer', checkpoint: true, allow_read: ['topic'], allow_write: ['draft'] },
  ],
  slots: {
    topic: { type: 'text', default: '' },
    draft: { type: 'text', default: '' },
  },
};

export const template3Stage: Template = {
  name: '3stage',
  description: 'non-checkpoint → checkpoint → non-checkpoint',
  stages: [
    { id: 's1', agent: 'a1', checkpoint: false, allow_read: ['*'], allow_write: ['out1'] },
    { id: 's2', agent: 'a2', checkpoint: true,  allow_read: ['out1'], allow_write: ['out2'] },
    { id: 's3', agent: 'a3', checkpoint: false, allow_read: ['out2'], allow_write: ['out3'] },
  ],
  slots: {
    out1: { type: 'text', default: '' },
    out2: { type: 'text', default: '' },
    out3: { type: 'text', default: '' },
  },
};

export const template4Stage: Template = {
  name: '4stage',
  description: 'all checkpoint stages',
  stages: [
    { id: 's1', agent: 'a1', checkpoint: true, allow_read: ['*'], allow_write: ['slot1'] },
    { id: 's2', agent: 'a2', checkpoint: true, allow_read: ['slot1'], allow_write: ['slot2'] },
    { id: 's3', agent: 'a3', checkpoint: true, allow_read: ['slot2'], allow_write: ['slot3'] },
    { id: 's4', agent: 'a4', checkpoint: true, allow_read: ['slot3'], allow_write: ['slot4'] },
  ],
  slots: {
    slot1: { type: 'text', default: '' },
    slot2: { type: 'text', default: '' },
    slot3: { type: 'text', default: '' },
    slot4: { type: 'text', default: '' },
  },
};

export const templateSingleCheckpoint: Template = {
  name: 'single-checkpoint',
  description: 'single stage',
  stages: [
    { id: 'only', agent: 'solo', checkpoint: true, allow_read: ['*'], allow_write: ['output'] },
  ],
  slots: {
    output: { type: 'text', default: '' },
  },
};

export function makeBaseState(overrides?: Partial<PipelineState>): PipelineState {
  return {
    template_name: 'simple-2stage',
    current_stage: 0,
    slot_values: { topic: '', draft: '' },
    slot_history: { topic: [], draft: [] },
    remarks: [],
    stage_history: [
      { stage: 0, stage_id: 'research', agent: 'researcher', started_at: '2025-01-01T00:00:00.000Z', versions: 0 },
    ],
    status: 'running',
    mode: 'relay' as PipelineMode,
    ...overrides,
  };
}

export function makeStateStage1Running(overrides?: Partial<PipelineState>): PipelineState {
  const state = makeBaseState({
    current_stage: 1,
    slot_values: { topic: 'research results', draft: '' },
    slot_history: {
      topic: [makeSlotEntry('research results', 'researcher', 0)],
      draft: [],
    },
    stage_history: [
      makeStageEntry(0, 'research', 'researcher', true),
      { stage: 1, stage_id: 'write', agent: 'writer', started_at: '2025-01-01T00:01:00.000Z', versions: 0 },
    ],
    ...overrides,
  });
  return state;
}

export function makeStateCompleted(): PipelineState {
  const state = makeBaseState({
    current_stage: 2,
    slot_values: { topic: 'done', draft: 'final content' },
    slot_history: {
      topic: [makeSlotEntry('done', 'researcher', 0)],
      draft: [makeSlotEntry('final content', 'writer', 0)],
    },
    stage_history: [
      makeStageEntry(0, 'research', 'researcher', true),
      makeStageEntry(1, 'write', 'writer', true),
    ],
    status: 'completed',
  });
  return state;
}

export function makeSlotEntry(content: string | object, agent: string, version: number): SlotHistoryEntry {
  return { content, written_at: new Date().toISOString(), version, agent };
}

export function makeStageEntry(stage: number, stage_id: string, agent: string, completed: boolean): StageHistoryEntry {
  return {
    stage, stage_id, agent,
    started_at: new Date().toISOString(),
    completed_at: completed ? new Date().toISOString() : undefined,
    versions: 1,
  };
}

export function makeRemark(agent: string, content: string, version: number): PipelineRemark {
  return { agent, content, timestamp: new Date().toISOString(), version };
}

export const mockToolContext: ToolContext = {
  agent_name: 'orchestrator',
  user_id: UID,
  project_id: PID,
  workspace_root: WR,
};

export const mockToolContextWriter: ToolContext = {
  agent_name: 'writer',
  user_id: UID,
  project_id: PID,
  workspace_root: WR,
};

export function makeEmptyProfile(): AgentProfile {
  return {
    agent: '',
    user_id: '',
    preferences: {},
    last_updated: new Date().toISOString(),
  };
}

export function makeStyleProfile(overrides?: Partial<Profile>): Profile {
  return {
    userId: UID,
    version: 1,
    corePrinciples: [],
    syntaxPatterns: {},
    vocabulary: { highFreq: [], forbidden: [], techTerms: [] },
    forbiddenPatterns: [],
    lastUpdated: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}
