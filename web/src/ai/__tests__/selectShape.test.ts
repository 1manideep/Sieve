// 11 section 10.3a (Nov 21, B15): the select prompt asks for "Yes." or "No." on a yes or no question, and one fact.
import { beforeEach, describe, expect, it } from 'vitest';
import { setLanguageModelForTests } from '../device/languageModel';
import { setHybridForTests } from '../hybrid';
import { PROMPT_VERSIONS } from '../versions';
import { SELECT_SYSTEM, VERIFY_SYSTEM } from '../prompts';
import { excerptBasis, fitPassages, selectAndAnswer, selectPrompt } from '../tasks/select';
import { createFakeHybrid } from '../testing/fakeHybrid';
import { installFakeLanguageModel } from '../testing/fakeLanguageModel';
import { resetAiForTests } from '../testing/reset';
import { RECORDS } from './fixtures';

const TODAY = new Date(2026, 10, 16, 10, 0).getTime();
const LINE = 'This is a yes or no question: "answer" is exactly "Yes." or "No.".';

describe('the select prompt and the answer shape', () => {
  it('a yes or no question gets the yes-or-no line; other questions do not', () => {
    const yes = 'Did I pay the deposit?';
    expect(selectPrompt(yes, fitPassages(yes, [RECORDS.deposit], {}, { today: TODAY }), { today: TODAY }).split('\n')).toContain(LINE);
    const what = 'When did I pay the deposit?';
    expect(selectPrompt(what, fitPassages(what, [RECORDS.deposit], {}, { today: TODAY }), { today: TODAY })).not.toContain(LINE);
  });

  it('the system prompt asks for one fact, no subject line, and Yes or No', () => {
    expect(SELECT_SYSTEM).toContain('One fact only');
    expect(SELECT_SYSTEM).toContain('Never copy the subject line unless the question asks for it.');
    expect(SELECT_SYSTEM).toContain('gets exactly "Yes." or "No."');
    expect(PROMPT_VERSIONS.select).toBe(3);
    expect(VERIFY_SYSTEM).toContain('A proposed answer of "Yes." or "No." is true only if the passage shows that answer to the question.');
    expect(PROMPT_VERSIONS.verify).toBe(2);
  });

  describe('a bare "Yes." still has its exact lines', () => {
    beforeEach(() => {
      resetAiForTests();
      setLanguageModelForTests(installFakeLanguageModel({ availability: { text: 'available', image: 'available' } }));
    });

    it('the excerpt is found from the question words', async () => {
      expect(excerptBasis('Yes.', 'Was my security deposit received?')).toBe('Was my security deposit received?');
      expect(excerptBasis('Your deposit was $1,200.', 'q')).toBe('Your deposit was $1,200.');
      setHybridForTests(createFakeHybrid(() => ({ text: JSON.stringify({ item: 'P1', answer: 'Yes.' }), source: 'on_device' })));
      const res = await selectAndAnswer('Was my security deposit received?', [RECORDS.deposit], 'sample', { today: TODAY });
      expect(res.ok && res.value.answer).toBe('Yes.');
      expect(res.ok && res.value.excerpt).toBe('We received your security deposit of $1,200 on March 3.');
    });
  });
});
