/**
 * Salary suggestion, worked out in code from the profile's rates and the posting.
 * Self-contained so it can be tested with node --test.
 */

export type SalaryPrefs = {
  floor_eur_hour: number | null;
  target_eur_hour: number | null;
  employment_discount_pct: number | null;
  hours_per_month: number;
};

export type PostedRange = { min: number | null; max: number | null }; // EUR per month

export type SalarySuggestion = {
  text: string; // what to put in the form or say
  monthly: number | null; // EUR per month, B2B
  belowFloor: boolean;
  basis: string; // how it was worked out
};

const round = (n: number, step = 100) => Math.round(n / step) * step;
const eur = (n: number) => `EUR ${round(n).toLocaleString("en-GB")}`;

export function suggestSalary(p: SalaryPrefs, posted: PostedRange, employment = false): SalarySuggestion {
  const hours = p.hours_per_month || 160;
  const discount = employment ? 1 - (p.employment_discount_pct ?? 0) / 100 : 1;
  const floor = p.floor_eur_hour ? p.floor_eur_hour * hours * discount : null;
  const target = p.target_eur_hour ? p.target_eur_hour * hours * discount : null;
  const kind = employment ? "gross per month (employment)" : "per month on B2B";

  if (!floor && !target) {
    return { text: "", monthly: null, belowFloor: false, basis: "Set your salary floor and target on the Profile page first." };
  }

  if (posted.max) {
    const lo = posted.min ?? posted.max;
    // Aim for the upper middle of the posted range, never below the floor.
    const aim = lo + (posted.max - lo) * 0.65;
    const value = Math.max(aim, floor ?? 0);
    const below = floor != null && posted.max < floor;
    return {
      text: `${eur(value)} ${kind}`,
      monthly: round(value),
      belowFloor: below,
      basis: below
        ? `The posted range tops out at ${eur(posted.max)}, below your floor of ${eur(floor!)}.`
        : `Upper middle of the posted ${eur(lo)} to ${eur(posted.max)}.`,
    };
  }

  const low = floor ?? target!;
  const high = target ?? floor!;
  return {
    text: low === high ? `${eur(low)} ${kind}` : `${eur(low)} to ${eur(high)} ${kind}`,
    monthly: round(high),
    belowFloor: false,
    basis: "No range in the posting, so your floor to target.",
  };
}
