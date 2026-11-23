// A long number the asker gave (an order, a booking, a job number) can come back from the on-device model with a
// digit dropped or doubled: "21068193" for 210668193, in every wording of one answer (Nov 22, 2026). The asker's own
// number is the one meant, so plain code writes it back. Nothing else in the answer is touched.
import { osaDistance } from '@/index/typos';

const RUN = /\d{5,}/g;

/**
 * The answer with each run of digits that is one edit away from a number the asker gave replaced by that number.
 * A run the item itself holds is left alone (it is another real number), and so is one that is near two asked numbers.
 * `asked`: the exact terms sent with the question, and the question's own text.
 */
export function repairAskedNumbers(answer: string, asked: readonly string[], itemText: string): string {
  const wanted = [...new Set(asked.flatMap((t) => t.match(/\d{6,}/g) ?? []))];
  if (wanted.length === 0) return answer;
  return answer.replace(RUN, (run) => {
    if (wanted.includes(run) || itemText.includes(run)) return run;
    const near = wanted.filter((w) => Math.abs(w.length - run.length) <= 1 && osaDistance(run, w, 1) <= 1);
    return near.length === 1 ? (near[0] as string) : run;
  });
}
