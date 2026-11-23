// A long number can come back from the on-device model with a digit dropped or doubled: "21068193" for 210668193, in
// every wording of one answer (Nov 22, 2026). A number that is in neither the item nor the question, and one edit
// away from a single number that is, is a miscopy of it, so plain code writes the real one back. Nothing else in the
// answer is touched.
import { osaDistance } from '@/index/typos';

const RUN = /\d{5,}/g;
const longRuns = (text: string): string[] => text.match(/\d{6,}/g) ?? [];

/**
 * The answer with each run of digits that is one edit away from a long number of the question or of the item replaced
 * by that number. A run that is itself in the item or the question is left alone, and so is one that is as near to
 * two different numbers. `asked`: the exact terms sent with the question, and the question's own text.
 */
export function repairLongNumbers(answer: string, asked: readonly string[], itemText: string): string {
  const real = [...new Set([...asked.flatMap(longRuns), ...longRuns(itemText)])];
  if (real.length === 0) return answer;
  return answer.replace(RUN, (run) => {
    if (real.includes(run) || itemText.includes(run)) return run;
    const near = real.filter((w) => Math.abs(w.length - run.length) <= 1 && osaDistance(run, w, 1) <= 1);
    return near.length === 1 ? (near[0] as string) : run;
  });
}
