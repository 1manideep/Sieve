import { describe, expect, it, vi } from 'vitest';
import { playgroundBridge } from '@/relay/playgroundBridge';
import { connectPlaygroundAssistant } from './playgroundAssistant';

const grant = { grantId: 'g1', link: 'https://sieve.example/mcp/secret', linkHint: 'cret', maxStep: 'answer', allowedCategories: [], allowedSources: ['playground'], expiresAt: 1 };
const issuePlaygroundGrant = vi.fn(async () => grant);
const stop = vi.fn();
const start = vi.fn(() => stop);

vi.mock('@/app/services/callables', () => ({ issuePlaygroundGrant }));
vi.mock('@/state/playgroundRelay', () => ({ usePlaygroundRelay: { getState: () => ({ start }) } }));

describe('connectPlaygroundAssistant', () => {
  it('gets the Playground grant first, then starts serving its requests once, over this tab\'s extension port', async () => {
    const session = await connectPlaygroundAssistant('anon-1');
    expect(issuePlaygroundGrant).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledWith('anon-1', playgroundBridge.makeEngineBridge);
    expect(issuePlaygroundGrant.mock.invocationCallOrder[0]).toBeLessThan(start.mock.invocationCallOrder[0]);
    expect(session.grant.link).toBe('https://sieve.example/mcp/secret');
    session.stop();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('does not start serving when the grant fails', async () => {
    issuePlaygroundGrant.mockRejectedValueOnce(new Error('denied'));
    start.mockClear();
    await expect(connectPlaygroundAssistant('anon-1')).rejects.toThrow('denied');
    expect(start).not.toHaveBeenCalled();
  });
});
