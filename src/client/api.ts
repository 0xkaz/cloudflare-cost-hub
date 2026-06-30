const API_BASE = '/api';

async function fetchJSON<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
  createdAt: string;
}

export interface AuthResponse {
  authenticated: boolean;
  user?: User;
}

export interface BillingSummary {
  accountId: string;
  accountName: string;
  currentMonthCost: number;
  previousMonthCost: number;
  forecastedCost: number;
  currency: string;
}

export interface UsageMetric {
  date: string;
  product: string;
  metric: string;
  value: number;
  unit: string;
}

export interface DailyValue {
  date: string;
  value: number;
}

export interface FreeTierStatus {
  product: string;
  metric: string;
  limit: number;
  used: number;
  remaining: number;
  percentage: number;
  unit: string;
  period: 'day' | 'month';
  daily: DailyValue[];
  paidIncluded?: number;
  paidPricePerUnit?: number;
  paidUnitSize?: number;
  paidUnitLabel?: string;
  monthlyUsed?: number;
  estimatedCost?: number;
}

export interface InstanceUsage {
  id: string;
  label: string;
  value: number;
}

export interface UsageBreakdown {
  product: string;
  metric: string;
  unit: string;
  total: number;
  instanceLabel: string;
  instances: InstanceUsage[];
}

export interface AccountPlan {
  workersPaid: boolean;
  r2Paid: boolean;
  plans: string[];
  accessible: boolean;
}

export interface DashboardData {
  summaries: BillingSummary[];
  dailyUsage: UsageMetric[];
  freeTierStatus: FreeTierStatus[];
  plan?: AccountPlan;
}

export const api = {
  getMe: () => fetchJSON<AuthResponse>('/auth/me'),
  logout: () => fetchJSON<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  getDashboard: (month?: string) =>
    fetchJSON<DashboardData>(`/dashboard${month ? `?month=${encodeURIComponent(month)}` : ''}`),
  getBreakdown: (product: string, metric: string, month?: string) =>
    fetchJSON<UsageBreakdown>(
      `/dashboard/breakdown?product=${encodeURIComponent(product)}&metric=${encodeURIComponent(
        metric
      )}${month ? `&month=${encodeURIComponent(month)}` : ''}`
    ),
  getTrend: () => fetchJSON<{ trend: TrendPoint[] }>('/dashboard/trend'),
  getServices: (month?: string) =>
    fetchJSON<ServicesAnalysis>(
      `/dashboard/services${month ? `?month=${encodeURIComponent(month)}` : ''}`
    ),
  getBudget: () => fetchJSON<BudgetView>('/budgets'),
  setBudget: (monthlyLimit: number) =>
    fetchJSON<{ ok: boolean; monthlyLimit: number }>('/budgets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monthlyLimit }),
    }),
  clearBudget: () => fetchJSON<{ ok: boolean }>('/budgets', { method: 'DELETE' }),
};

export interface BudgetStatus {
  limit: number;
  forecast: number;
  percentage: number;
  nearing: boolean;
  exceeded: boolean;
}

export interface BudgetView {
  accountId: string;
  accountName: string;
  monthlyLimit: number | null;
  forecast: number;
  status: BudgetStatus | null;
}

export interface TrendPoint {
  month: string;
  cost: number | null;
  forecast: number | null;
}

export type Tier = 'free' | 'paid' | 'billable';

export interface ServiceMetricSummary {
  product: string;
  metric: string;
  unit: string;
  used: number;
  limit: number;
  percentage: number;
  period: 'day' | 'month';
  tier: Tier;
  monthlyUsed?: number;
  paidIncluded?: number;
  estimatedCost?: number;
}

export interface ServiceSummary {
  product: string;
  totalCost: number;
  tier: Tier;
  metrics: ServiceMetricSummary[];
}

export interface CostDriver {
  product: string;
  metric: string;
  instanceLabel: string;
  id: string;
  label: string;
  value: number;
  unit: string;
  paidShare?: number;
  estimatedCost: number;
}

export interface ServiceTrend {
  product: string;
  points: Array<{ month: string; cost: number }>;
}

export interface ServicesAnalysis {
  month: string;
  accountName: string;
  currentMonthCost: number;
  forecastedCost: number;
  services: ServiceSummary[];
  topDrivers: CostDriver[];
  trends: ServiceTrend[];
}
