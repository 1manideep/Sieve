import { describe, expect, it } from 'vitest';
import questionsJson from '../../../data/playground/questions.json';
import { BASE_SUGGESTIONS, playgroundSuggestions, stripExtension, uploadQuestion } from './suggestions';

interface QuestionsFile { suggestions: { id: string; chip: boolean; text: string }[] }
const questions = questionsJson as QuestionsFile;

describe('playground suggestions', () => {
  it('match the dataset: ids, order and texts of the chips', () => {
    const chips = questions.suggestions.filter((q) => q.chip && q.id !== 'upload');
    expect([...BASE_SUGGESTIONS.map((s) => s.id), 'mytest']).toEqual(chips.map((q) => q.id));
    for (const s of playgroundSuggestions({ hasTestEmail: true })) {
      expect(s.text).toBe(chips.find((q) => q.id === s.id)?.text);
    }
  });

  it('show five, then mytest after a test email, then the newest file', () => {
    expect(playgroundSuggestions({ hasTestEmail: false }).map((s) => s.id)).toEqual(['landlord', 'hotdog', 'bank', 'health', 'parcel']);
    expect(playgroundSuggestions({ hasTestEmail: true, latestFileName: 'move-out-notes.txt' }).map((s) => s.id)).toEqual([
      'landlord', 'hotdog', 'bank', 'health', 'parcel', 'mytest', 'upload',
    ]);
    expect(playgroundSuggestions({ hasTestEmail: false, latestFileName: 'move-out-notes.txt' }).pop()?.text).toBe('What does move-out-notes say?');
  });

  it('drop the file extension only', () => {
    expect(stripExtension('Lease_2026.pdf')).toBe('Lease_2026');
    expect(stripExtension('archive.tar.gz')).toBe('archive.tar');
    expect(stripExtension('.notes')).toBe('.notes');
    expect(stripExtension('README')).toBe('README');
    expect(uploadQuestion('photo.final.jpg')).toBe('What does photo.final say?');
  });
});
