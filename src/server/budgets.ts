// Pure budget evaluation shared by the budgets API and the alert digest.
export interface BudgetStatus {
  limit: number;
  forecast: number;
  percentage: number; // forecast as a % of the limit (0+, may exceed 100)
  nearing: boolean; // >= 80% of the limit
  exceeded: boolean; // forecast over the limit
}

const NEARING_THRESHOLD = 0.8;

export function evaluateBudget(limit: number, forecast: number): BudgetStatus {
  const ratio = limit > 0 ? forecast / limit : 0;
  return {
    limit,
    forecast,
    percentage: Math.round(ratio * 100),
    nearing: ratio >= NEARING_THRESHOLD,
    exceeded: forecast > limit,
  };
}
