// The plain-code labeller (10 section 10.2), as changed on Nov 21, 2026 after 300 labelled emails showed that mail
// matching no category's words was all filed under Personal. Senders and subjects here are made up.
import { describe, expect, it } from 'vitest';
import type { Category, IndexRecord } from '@sieve/shared';
import { codeLabel, codeRelabel, isBulkTab, isHealthStrong, isPetCare, isSystemSender } from '../tasks/codeLabel';

const email = (from: string, title: string, over: Partial<IndexRecord> = {}) => ({ kind: 'email' as const, from, title, preview: '', ...over });
const label = (from: string, title: string, over: Partial<IndexRecord> = {}) => codeLabel(email(from, title, over));

describe('isSystemSender: a company\'s system, read from the address alone', () => {
  it.each([
    'Kestrelmoor Bank <no-reply@kestrelmoor.example>',
    'alerts@kestrelmoor.example',
    'jobalerts-noreply@nexabridge.example',
    'Crestmarrow <hello@e.crestmarrow.example>',
    'team@info.voltwren.example',
    'member@notify.pellwater.example',
    'crestmarrow@tm.crestmarrow.example',          // named after its own domain
    'Thistlewick <thistlewick@emailrelay.example>',
    'billing-noreply@nexabridge.example',
  ])('%s is a system', (from) => expect(isSystemSender(from)).toBe(true));

  it.each([
    'Jordan Ellis <jordan.ellis@gmail.com>',
    'priya@outlook.com',
    'Dana Whitfield <dana@thistlewick.example>',
    'marcus.lee@company.example',
    undefined,
    'no address here',
  ])('%s is a person (or unknown)', (from) => expect(isSystemSender(from)).toBe(false));
});

describe('codeLabel', () => {
  it('files a system\'s mail that matches no category as Newsletters, never as Personal', () => {
    expect(label('hello@e.crestmarrow.example', 'Consider this your official warning.')).toEqual({ category: 'Newsletters', matched: true });
    expect(label('jobalerts-noreply@nexabridge.example', 'AI Engineer at Tensorfield and more')).toEqual({ category: 'Newsletters', matched: true });
    // The Personal words are for people: a newsletter that mentions them stays a newsletter.
    expect(label('newsletters-noreply@nexabridge.example', 'When Mom and Dad are a little too involved').category).toBe('Newsletters');
  });

  it('keeps a person\'s mail Personal: by its words, or as "not sorted yet" when nothing matched', () => {
    expect(label('Jordan Ellis <jordan.ellis@gmail.com>', 'Are we still on for Saturday?')).toEqual({ category: 'Personal', matched: true });
    expect(label('Jordan Ellis <jordan.ellis@gmail.com>', 'quick question')).toEqual({ category: 'Personal', matched: false });
    expect(label('Dana Whitfield <dana@thistlewick.example>', 'quick question')).toEqual({ category: 'Personal', matched: false });
  });

  it('a notice about the person\'s own account is theirs, not a newsletter', () => {
    expect(label('no-reply@accounts.voltwren.example', 'Security alert')).toEqual({ category: 'Personal', matched: true });
    expect(label('info@account.voltwren.example', 'Action needed: Verify your recently changed phone number').category).toBe('Personal');
    expect(label('noreply@email.voltwren.example', 'Your Voltwren Account was used to sign in on a web browser').category).toBe('Personal');
  });

  it.each<[string, string, Category]>([
    ['alerts@kestrelmoor.example', 'Your account ending in (...2299) is overdrawn', 'Money'],
    ['alerts@kestrelmoor.example', 'Low balance alert for your checking account', 'Money'],
    ['kestrelmoor@services.kestrelmoor.example', 'Your Kestrelmoor Card was declined', 'Money'],
    ['service@swapfern.example', 'Voltwren Services: $9.99 USD', 'Money'],
    ['cloud-noreply@voltwren.example', '50% of budget reached', 'Money'],
    ['Jordan Ellis <jordan.ellis@gmail.com>', 'Invoice SV-0042 from Northwind Design', 'Money'],
    ['jobs-noreply@nexabridge.example', 'Your application was sent to Tensorfield', 'Work'],
    ['notifications@codehost.example', '[acme/ratchet] PR run failed: CI', 'Work'],
    ['officeinterviews@carehouse.example', 'Reminder: Virtual Chat', 'Work'],
    ['billing-noreply@nexabridge.example', 'Thank you for purchasing Premium', 'Shopping'],
    ['noreply-purchases@voltwren.example', 'Congratulations, your membership was reactivated', 'Shopping'],
    ['system@propertydesk.example', 'Your delivery was picked up!', 'Home'],
    ['hello@e.crestmarrow.example', '68% Discount Unlocked!', 'Newsletters'],
    ['guest@choose.albatrine.example', 'Ends soon: Up to 60% bonus miles', 'Newsletters'],
    ['Corvane Medical Group <no-reply@corvane.example>', 'Your test results are ready to view', 'Health'],
  ])('%s · %s is %s', (from, title, category) => expect(label(from, title).category).toBe(category));

  it('a promotion in the subject is a newsletter even from an address that looks like a person\'s', () => {
    expect(label('virgil@taplane.example', 'Last chance: exclusive rewards for members')).toEqual({ category: 'Newsletters', matched: true });
  });

  it('what the source says about mail sent to many only decides mail that matched no category', () => {
    expect(isBulkTab(['INBOX', 'CATEGORY_PROMOTIONS'])).toBe(true);
    expect(isBulkTab(['INBOX', 'CATEGORY_UPDATES'])).toBe(false);
    expect(isBulkTab(undefined)).toBe(false);
    expect(label('virgil@taplane.example', 'What? A new thing in Taplane...', { bulk: true })).toEqual({ category: 'Newsletters', matched: true });
    expect(label('virgil@taplane.example', 'What? A new thing in Taplane...')).toEqual({ category: 'Personal', matched: false });
    // A category's own words still win, and Health always does.
    expect(label('orders@crestmarrow.example', 'Your order has shipped', { bulk: true }).category).toBe('Shopping');
    expect(label('care@corvane.example', 'Appointment reminder: Dr. Patel', { bulk: true }).category).toBe('Health');
  });

  it('photos and files are sorted as before', () => {
    expect(codeLabel({ kind: 'photo', title: 'IMG_1.jpg', preview: 'A tabby cat asleep on a windowsill' })).toEqual({ category: 'Photos', matched: true });
    expect(codeLabel({ kind: 'photo', title: 'IMG_2.jpg', preview: 'A receipt for an order' }).category).toBe('Shopping');
    expect(codeLabel({ kind: 'document', title: 'Lease renewal 2026.pdf', preview: '' }).category).toBe('Home');
    expect(codeLabel({ kind: 'note', title: 'chili-recipe.txt', preview: '' })).toEqual({ category: 'Personal', matched: false });
  });
});

describe('codeRelabel: the index catches up with better rules', () => {
  const rec = (over: Partial<IndexRecord>) => ({ ...email('hello@e.crestmarrow.example', 'big savings on bundles'), category: 'Personal' as Category, categoryBy: 'code' as const, ...over });

  it('gives a code-sorted item the category the current rules give it', () => {
    expect(codeRelabel(rec({}))).toBe('Newsletters');
    expect(codeRelabel(rec({ category: 'Newsletters' }))).toBeNull();          // already there
  });

  it('never touches what a model, a rule or a seed chose, or a photo', () => {
    for (const categoryBy of ['device', 'cloud', 'rule', 'seed'] as const) expect(codeRelabel(rec({ categoryBy }))).toBeNull();
    expect(codeRelabel(rec({ kind: 'photo' }))).toBeNull();
  });

  it('settles a model label that plain code disagreed with, never out of Health and only when plain code matched', () => {
    const low = { v: 1, by: 'device' as const, at: 1, confidence: 'low' as const };
    const high = { v: 1, by: 'device' as const, at: 1, confidence: 'high' as const };
    const promo = { ...email('hello@e.crestmarrow.example', 'Consider this your official warning'), categoryBy: 'device' as const };
    expect(codeRelabel({ ...promo, category: 'Shopping', enrich: { label: low } })).toBe('Newsletters');
    expect(codeRelabel({ ...promo, category: 'Shopping', enrich: { label: high } })).toBeNull();      // they agreed then
    expect(codeRelabel({ ...promo, category: 'Health', enrich: { label: low } })).toBeNull();         // fails closed
    expect(codeRelabel({ ...promo, category: 'Newsletters', enrich: { label: low } })).toBeNull();    // already there
    const person = { ...email('Jordan Ellis <jordan.ellis@gmail.com>', 'quick question'), categoryBy: 'device' as const };
    expect(codeRelabel({ ...person, category: 'Work', enrich: { label: low } })).toBeNull();          // plain code has no words for it
  });

  it('keeps what the source said about mail sent to many', () => {
    const quiet = { ...email('virgil@taplane.example', 'A new thing in Taplane'), category: 'Newsletters' as Category, categoryBy: 'code' as const };
    expect(codeRelabel({ ...quiet, bulk: true })).toBeNull();
    expect(codeRelabel(quiet)).toBe('Personal');
  });

  it('moves mail about a pet out of Health, whoever filed it there, and nothing else', () => {
    const high = { v: 1, by: 'device' as const, at: 1, confidence: 'high' as const };
    const pet = { ...email('Pawlow Pet Insurance <hello@pawlow.example>', 'Welcome to your pet insurance plan'), category: 'Health' as Category };
    for (const categoryBy of ['device', 'cloud', 'rule', 'code'] as const) expect(codeRelabel({ ...pet, categoryBy, enrich: { label: high } })).toBe('Personal');
    expect(codeRelabel({ ...pet, categoryBy: 'seed' })).toBeNull();
    const own = { ...email('Marlow Clinic <noreply@marlowclinic.example>', 'Your lab results are ready'), category: 'Health' as Category, categoryBy: 'device' as const };
    expect(codeRelabel({ ...own, enrich: { label: high } })).toBeNull();
  });
});

describe('rules added on Nov 21, 2026', () => {
  it('a pet\'s insurance or vet is Personal, and never trips the Health safety net', () => {
    for (const [from, title] of [
      ['Pawlow Pet Insurance <hello@pawlow.example>', 'Your dog is covered from nose to tail'],
      ['Harbor Animal Hospital <front@harborvet.example>', 'Your appointment on Friday'],
      ['Dr. Reyes <reyes@northsidevet.example>', 'Veterinary visit summary'],
    ] as const) {
      const item = email(from, title);
      expect(isPetCare(item)).toBe(true);
      expect(isHealthStrong(item)).toBe(false);
      expect(codeLabel(item)).toEqual({ category: 'Personal', matched: true });
    }
    const own = email('Marlow Clinic <noreply@marlowclinic.example>', 'Your lab results are ready');
    expect(isPetCare(own)).toBe(false);
    expect(isHealthStrong(own)).toBe(true);
    expect(codeLabel(own).category).toBe('Health');
  });

  it('an investment order and a payment plan are Money, not Shopping', () => {
    expect(codeLabel(email('Finchley Invest <noreply@mailer.finchley.example>', 'Your SIP order was placed')).category).toBe('Money');
    expect(codeLabel(email('Paylater <noreply@paylater.example>', 'Updated payment plan for your order')).category).toBe('Money');
    expect(codeLabel(email('Tindle Store <orders@tindle.example>', 'Your order #A1024 has shipped')).category).toBe('Shopping');
  });

  it('a bus or train booking is Travel; the same company\'s sale stays a newsletter', () => {
    expect(codeLabel(email('Northline Bus <noreply@booking.northline.example>', 'Booking Confirmation #5520018842')).category).toBe('Travel');
    expect(codeLabel(email('Coastrail <tickets@coastrail.example>', 'Your train ticket and boarding pass')).category).toBe('Travel');
    expect(codeLabel(email('Coastrail <news@e-mail.coastrail.example>', 'Flash sale! Weekend fares from $29')).category).toBe('Newsletters');
  });
});
