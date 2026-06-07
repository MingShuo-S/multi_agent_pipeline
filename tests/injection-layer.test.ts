import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WR, UID, PID, simpleTemplate2Stage, makeStateStage1Running, makeStyleProfile } from './fixtures/templates.js';

const { mockFs, resetFs, setFile } = vi.hoisted(() => {
  const files = new Map<string, string>();
  const enoent = (p: string) => { const e = new Error(`ENOENT: ${p}`) as any; e.code = 'ENOENT'; throw e; };
  const norm = (p: string) => p.replace(/\\/g, '/');
  return {
    mockFs: {
      promises: {
        readFile: async (p: string) => { const k = norm(p); if (files.has(k)) return files.get(k)!; throw enoent(p); },
        writeFile: async (p: string, c: string) => { files.set(norm(p), c); },
        mkdir: async () => {},
        readdir: async (dir: string) => {
          const prefix = norm(dir) + '/';
          return [...files.keys()].filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length).split('/')[0]);
        },
      },
    },
    setFile: (path: string, content: string) => files.set(norm(path), content),
    resetFs: () => files.clear(),
  };
});
vi.mock('fs', () => mockFs);

import { InjectionLayer } from '../src/runtime/injection-layer.js';

const sharedDir = `${WR}/_shared/${UID}`;

describe('InjectionLayer', () => {
  let layer: InjectionLayer;

  beforeEach(() => { resetFs(); vi.clearAllMocks(); layer = new InjectionLayer(WR, UID); });

  describe('buildForRole', () => {
    it('content-writer 拿到风格 DNA headBlock', async () => {
      setFile(`${sharedDir}/style-dna.json`, JSON.stringify(makeStyleProfile({
        dna: {
          corePrinciples: ['简洁', '口语化'],
          syntaxPatterns: { preferedSentenceLength: 20 },
          vocabulary: { highFreq: ['非常'], forbidden: ['首先'], techTerms: [] },
          forbiddenPatterns: ['不要用感叹号'],
          growthDirection: '更自然',
        },
      })));
      const { headBlock, tailBlock } = await layer.buildForRole('content-writer', makeStateStage1Running(), simpleTemplate2Stage, PID);
      expect(headBlock).toContain('【强制系统指令】');
      expect(headBlock).toContain('【风格硬规则（HOT）】');
      expect(headBlock).toContain('简洁');
      expect(headBlock).toContain('【风格约束（WARM）】');
      expect(headBlock).toContain('不要用感叹号');
      expect(headBlock).toContain('禁止模式');
      expect(headBlock).toContain('禁用词汇');
      expect(headBlock).toContain('首先');
      expect(headBlock).toContain('非常');
      expect(headBlock).toContain('更自然');
      expect(tailBlock).toContain('【阶段约束】');
      expect(tailBlock).toContain('stage 2/2');
    });

    it('非 content-writer 不含风格 DNA', async () => {
      setFile(`${sharedDir}/style-dna.json`, JSON.stringify(makeStyleProfile({
        dna: { corePrinciples: ['简洁'], syntaxPatterns: {}, vocabulary: { highFreq: [], forbidden: [], techTerms: [] }, forbiddenPatterns: [], growthDirection: '' },
      })));
      const { headBlock } = await layer.buildForRole('topic-researcher', makeStateStage1Running(), simpleTemplate2Stage, PID);
      expect(headBlock).not.toContain('【风格硬规则（HOT）】');
      expect(headBlock).not.toContain('简洁');
    });

    it('无 style-dna 时 headBlock 不含风格', async () => {
      const { headBlock } = await layer.buildForRole('content-writer', makeStateStage1Running(), simpleTemplate2Stage, PID);
      expect(headBlock).not.toContain('【风格硬规则（HOT）】');
      expect(headBlock).toContain('【强制系统指令】');
    });

    it('有 corePrinciples 但无 forbid/highFreq 时不含 WARM 段', async () => {
      setFile(`${sharedDir}/style-dna.json`, JSON.stringify(makeStyleProfile({
        dna: {
          corePrinciples: ['简洁'],
          syntaxPatterns: {},
          vocabulary: { highFreq: [], forbidden: [], techTerms: [] },
          forbiddenPatterns: [],
          growthDirection: '',
        },
      })));
      const { headBlock } = await layer.buildForRole('content-writer', makeStateStage1Running(), simpleTemplate2Stage, PID);
      expect(headBlock).toContain('【风格硬规则（HOT）】');
      expect(headBlock).not.toContain('【风格约束（WARM）】');
    });

    it('headBlock 始终包含工作区全局规则', async () => {
      const { headBlock } = await layer.buildForRole('orchestrator', makeStateStage1Running(), simpleTemplate2Stage, PID);
      expect(headBlock).toContain('【工作区全局规则】');
      expect(headBlock).toContain(WR);
    });

    it('tailBlock 包含阶段和项目信息', async () => {
      const { tailBlock } = await layer.buildForRole('writer', makeStateStage1Running(), simpleTemplate2Stage, PID);
      expect(tailBlock).toContain('stage 2');
      expect(tailBlock).toContain(PID);
      expect(tailBlock).toContain('style_record_feedback');
      expect(tailBlock).toContain('kb_write');
    });
  });
});
