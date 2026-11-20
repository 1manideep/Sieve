// The copy of 70: final strings, no em or en dashes, the send-guard sentence rules, and parity with the copy the
// screens already show (web/src/copy/strings.ts), so the two can never drift apart unnoticed.
import { describe, expect, it } from 'vitest';
import { HOME_BASE, SEND_CHECK, STATUS_LISTENER } from '@/copy/strings';
import { allStaticCopy, FILE_COPY, INDEX_COPY, PLATFORM_COPY, QUESTION_COPY, RELAY_COPY, SEND_GUARD, sourceName } from './copy';

describe('copy of 70', () => {
  it('has no em or en dashes and no double spaces', () => {
    for (const s of allStaticCopy()) {
      expect(s).not.toMatch(/[\u2013\u2014]/);
      expect(s).not.toMatch(/ {2}/);
    }
  });

  it('every send-guard message ends with "Nothing was sent."', () => {
    const msgs = [
      SEND_GUARD.textMismatch, SEND_GUARD.empty, SEND_GUARD.tooLong, SEND_GUARD.notClean, SEND_GUARD.missingItem, SEND_GUARD.ruleNever('Money'),
      SEND_GUARD.requestClosed, SEND_GUARD.expired, SEND_GUARD.stepTooHigh('Helper'), SEND_GUARD.categoryNotAllowed('Helper', 'Money'),
      SEND_GUARD.sourceNotAllowed('Helper', 'gmail'), SEND_GUARD.blocked('Helper'), SEND_GUARD.unmaskedNumber('card'),
    ];
    for (const m of msgs) expect(m.endsWith(' Nothing was sent.')).toBe(true);
    expect(SEND_GUARD.stoppedTrace(SEND_GUARD.ruleNever('Money'))).toBe('Stopped just before sending: Your rules now never share Money items.');
  });

  it('source names', () => {
    expect([sourceName('gmail'), sourceName('folder'), sourceName('upload'), sourceName('nope')]).toEqual(['your Gmail', 'your folder', 'files you added', 'that source']);
  });

  it('placeholders', () => {
    expect(PLATFORM_COPY.checkTheAnswer(['$1,500'])).toBe("Check the answer: $1,500 is not in the item. Share the exact lines if you're not sure.");
    expect(PLATFORM_COPY.checkTheAnswer(['$1,500', 'Dec 4'])).toBe("Check the answer: $1,500, Dec 4 are not in the item. Share the exact lines if you're not sure.");
    expect(RELAY_COPY.mayOnlyReceive('Helper', 'answer')).toBe('Helper may only receive the answer.');
    expect(INDEX_COPY.couldNotCheck('email', INDEX_COPY.couldNotCheckReason['no-token'], 'Nov 16')).toBe(
      "Sieve couldn't check that this email is still there (Gmail needs you to sign in again). It was there on Nov 16.",
    );
    expect(QUESTION_COPY.actionWarning('forward')).toBe("This asks Sieve to forward. Sieve can't do that: it only finds things and shares what you approve.");
    expect(FILE_COPY.noReadableText(2)).toBe('2 PDFs have no readable text (often scans). Sieve finds them by name only.');
    expect(INDEX_COPY.shortenPathStart('a/'.repeat(40) + 'W-2.pdf').length).toBe(60);
    expect(INDEX_COPY.shortenPathStart('Taxes/2025')).toBe('Taxes/2025');
  });
});

describe('parity with web/src/copy/strings.ts', () => {
  it('the send-check copy is the same', () => {
    expect(SEND_CHECK.textMismatch).toBe(SEND_GUARD.textMismatch);
    expect(SEND_CHECK.empty).toBe(SEND_GUARD.empty);
    expect(SEND_CHECK.tooLong).toBe(SEND_GUARD.tooLong);
    expect(SEND_CHECK.missingItem).toBe(SEND_GUARD.missingItem);
    expect(SEND_CHECK.ruleNever('Money')).toBe(SEND_GUARD.ruleNever('Money'));
    expect(SEND_CHECK.requestClosed).toBe(SEND_GUARD.requestClosed);
    expect(SEND_CHECK.expired).toBe(SEND_GUARD.expired);
    expect(SEND_CHECK.stepTooHigh('Helper')).toBe(SEND_GUARD.stepTooHigh('Helper'));
    expect(SEND_CHECK.categoryNotAllowed('Helper', 'Money')).toBe(SEND_GUARD.categoryNotAllowed('Helper', 'Money'));
    for (const s of ['gmail', 'folder', 'upload']) expect(SEND_CHECK.sourceNotAllowed('Helper', s)).toBe(SEND_GUARD.sourceNotAllowed('Helper', s));
    expect(SEND_CHECK.blocked('Helper')).toBe(SEND_GUARD.blocked('Helper'));
    expect(SEND_CHECK.passedTrace).toBe(SEND_GUARD.passedTrace);
    expect(SEND_CHECK.stoppedTrace(SEND_GUARD.expired)).toBe(SEND_GUARD.stoppedTrace(SEND_GUARD.expired));
  });

  it('the home base copy is the same', () => {
    expect(HOME_BASE.waitingForClick).toBe(PLATFORM_COPY.waitingForClick);
    expect(HOME_BASE.waitingHidden).toBe(PLATFORM_COPY.waitingHidden);
    expect(HOME_BASE.expiredToast('Helper')).toBe(PLATFORM_COPY.expiredToast('Helper'));
    expect(HOME_BASE.revokedToast('Helper')).toBe(RELAY_COPY.revokedToast('Helper'));
    expect(HOME_BASE.mayOnlyReceive('Helper', 'answer')).toBe(RELAY_COPY.mayOnlyReceive('Helper', 'answer'));
    expect(HOME_BASE.mayOnlyReceive('Helper', 'excerpt')).toBe(RELAY_COPY.mayOnlyReceive('Helper', 'excerpt'));
    expect(HOME_BASE.discardedToast).toBe(PLATFORM_COPY.discarded);
    expect(STATUS_LISTENER.reconnecting).toBe(PLATFORM_COPY.homeBaseReconnecting);
    expect(STATUS_LISTENER.stopped).toBe(PLATFORM_COPY.homeBaseStopped);
    expect(STATUS_LISTENER.signOut).toBe(PLATFORM_COPY.signOut);
  });
});
