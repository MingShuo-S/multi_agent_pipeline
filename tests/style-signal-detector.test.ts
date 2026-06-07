import { describe, it, expect } from 'vitest';
import { detectStyleSignals } from '../src/tools/style-signal-detector.js';

describe('detectStyleSignals', () => {

  it('空消息返回空数组', () => {
    expect(detectStyleSignals('')).toEqual([]);
  });

  it('普通消息不触发任何信号', () => {
    expect(detectStyleSignals('你好，今天天气不错')).toEqual([]);
    expect(detectStyleSignals('请把这段文字润色一下')).toEqual([]);
  });

  describe('中文纠正信号', () => {
    it('检测"不是X"模式', () => {
      const result = detectStyleSignals('不是这样的风格。');
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('correction');
    });

    it('检测"改成X吧"', () => {
      const result = detectStyleSignals('改成活泼一点的风格吧');
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('correction');
      expect(result[0].quote).toContain('活泼一点');
    });

    it('检测"应该是X"', () => {
      const result = detectStyleSignals('应该是更正式的写法');
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('correction');
    });

    it('检测"建议写成X"', () => {
      const result = detectStyleSignals('建议写成更短促的句子。');
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('correction');
    });
  });

  describe('英文纠正信号', () => {
    it('检测"it\'s not X"', () => {
      const result = detectStyleSignals("it's not what I wanted");
      expect(result.some(s => s.type === 'correction')).toBe(true);
    });

    it('检测"that is not X"', () => {
      const result = detectStyleSignals("that is not correct");
      expect(result.some(s => s.type === 'correction')).toBe(true);
    });
  });

  describe('禁止信号', () => {
    it('中文"不要用"触发 forbidden', () => {
      const result = detectStyleSignals('不要用感叹号');
      expect(result.some(s => s.type === 'forbidden')).toBe(true);
    });

    it('中文"别用"触发 forbidden', () => {
      const result = detectStyleSignals('别用长句子');
      expect(result.some(s => s.type === 'forbidden')).toBe(true);
    });

    it('中文"去掉"触发 forbidden', () => {
      const result = detectStyleSignals('去掉那些专业术语');
      expect(result.some(s => s.type === 'forbidden')).toBe(true);
    });

    it('英文"don\'t use"触发 forbidden', () => {
      const result = detectStyleSignals("don't use emoji");
      expect(result.some(s => s.type === 'forbidden')).toBe(true);
    });

    it('英文"avoid"触发 forbidden', () => {
      const result = detectStyleSignals('avoid long sentences');
      expect(result.some(s => s.type === 'forbidden')).toBe(true);
    });

    it('只生成一个 forbidden 信号（多个匹配取第一个）', () => {
      const result = detectStyleSignals('不要用感叹号，也别用长句子');
      const forbiddens = result.filter(s => s.type === 'forbidden');
      expect(forbiddens).toHaveLength(1);
    });
  });

  describe('正面信号', () => {
    it('"好"触发 praise', () => {
      const result = detectStyleSignals('好');
      expect(result.some(s => s.type === 'praise')).toBe(true);
    });

    it('"不错"触发 praise', () => {
      const result = detectStyleSignals('不错');
      expect(result.some(s => s.type === 'praise')).toBe(true);
    });

    it('"great"触发 praise', () => {
      const result = detectStyleSignals('great');
      expect(result.some(s => s.type === 'praise')).toBe(true);
    });

    it('带标点的 praise 也匹配', () => {
      const result = detectStyleSignals('很好！');
      expect(result.some(s => s.type === 'praise')).toBe(true);
    });

    it('长消息不触发 praise', () => {
      const result = detectStyleSignals('很好，但需要再调整一下');
      expect(result.some(s => s.type === 'praise')).toBe(false);
    });
  });

  describe('混合信号', () => {
    it('纠正 + 禁止同时出现', () => {
      const result = detectStyleSignals('不是这个风格，不要用感叹号');
      expect(result.some(s => s.type === 'correction')).toBe(true);
      expect(result.some(s => s.type === 'forbidden')).toBe(true);
    });

    it('纠正 + praise 不同时出现（praise 只匹配纯短消息）', () => {
      const result = detectStyleSignals('不是这个风格，好');
      expect(result.some(s => s.type === 'correction')).toBe(true);
      // praise should NOT match here since message has more content
      expect(result.filter(s => s.type === 'praise')).toHaveLength(0);
    });
  });
});
