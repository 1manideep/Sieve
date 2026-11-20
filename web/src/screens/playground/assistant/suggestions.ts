// Suggested questions for the Playground assistant, from data/playground/questions.json (whose expected items the
// index tests check): the landlord deposit question first, then a plain match, then a Health item that is never shared
// (00 D6: Gemini hears only "Nothing to share for that.", while the person sees the real reason here).
import questionsJson from '../../../../../data/playground/questions.json';

export const ASSISTANT_SUGGESTION_IDS = ['landlord', 'flight', 'health'] as const;

interface QuestionsFile {
  suggestions: { id: string; text: string }[];
}

export const ASSISTANT_SUGGESTIONS: readonly string[] = ASSISTANT_SUGGESTION_IDS.map(
  (id) => (questionsJson as QuestionsFile).suggestions.find((q) => q.id === id)?.text,
).filter((text): text is string => typeof text === 'string' && text !== '');
