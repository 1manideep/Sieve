import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AssistantMark } from './AssistantMark';
import { ASSISTANT_KINDS, assistantKindOf } from './assistants';

describe('assistantKindOf', () => {
  it('maps a connection name to its assistant, longer names first', () => {
    expect(assistantKindOf('Claude')).toBe('claude');
    expect(assistantKindOf('claude code on my mac')).toBe('claudeCode');
    expect(assistantKindOf('Claude-Code')).toBe('claudeCode');
    expect(assistantKindOf('Gemini')).toBe('gemini');
    expect(assistantKindOf('Gemini CLI')).toBe('geminiCli');
    expect(assistantKindOf('ChatGPT')).toBe('chatgpt');
    expect(assistantKindOf('OpenAI agent')).toBe('chatgpt');
    expect(assistantKindOf('Cursor')).toBe('cursor');
    expect(assistantKindOf('Notes helper')).toBe('other');
    expect(assistantKindOf(undefined)).toBe('other');
  });
});

describe('AssistantMark', () => {
  it('draws every kind, hidden from assistive tech, grey when not live', () => {
    for (const kind of ASSISTANT_KINDS) {
      const { container, unmount } = render(<AssistantMark kind={kind} live={kind === 'claude'} />);
      const disc = container.firstElementChild as HTMLElement;
      expect(disc.getAttribute('aria-hidden')).toBe('true');
      expect(disc.querySelector('path')).not.toBeNull();
      expect(disc.className.includes('dim')).toBe(kind !== 'claude');
      unmount();
    }
  });

  it('marks the command-line variants with a terminal badge', () => {
    const { container } = render(<AssistantMark kind="geminiCli" />);
    expect(container.querySelectorAll('svg')).toHaveLength(2);
  });
});
