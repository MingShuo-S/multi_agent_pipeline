import { describe, it, expect } from 'vitest';
import { extractAssistantText } from '../src/types.js';

describe('extractAssistantText', () => {
  it('从消息数组中提取最后一条 assistant 内容', () => {
    const messages = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'world' },
    ];
    expect(extractAssistantText(messages)).toBe('world');
  });

  it('跳过非字符串 content', () => {
    const messages = [
      { role: 'assistant', content: null },
      { role: 'assistant', content: 'valid' },
    ];
    expect(extractAssistantText(messages)).toBe('valid');
  });

  it('没有 assistant 消息返回空字符串', () => {
    expect(extractAssistantText([{ role: 'user', content: 'hi' }])).toBe('');
  });

  it('空数组返回空字符串', () => {
    expect(extractAssistantText([])).toBe('');
  });

  it('多个 assistant 取最后一条', () => {
    const messages = [
      { role: 'assistant', content: 'first' },
      { role: 'assistant', content: 'second' },
    ];
    expect(extractAssistantText(messages)).toBe('second');
  });
});
