export interface User {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
  createdAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
}

export interface CloudflareAccount {
  id: string;
  workspaceId: string;
  name: string;
  accountId: string;
  apiTokenEncrypted: string;
  createdAt: string;
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
  // Whether the limit applies per-day or per-month — drives how the detail view
  // compares the daily series against the limit.
  period: 'day' | 'month';
  // Daily breakdown for the selected month, used by the over-limit detail view.
  daily: DailyValue[];
  // Paid-plan comparison (present when the metric is separately billed).
  paidIncluded?: number; // monthly allowance included in the paid plan
  paidPricePerUnit?: number; // USD per paidUnitSize beyond the allowance
  paidUnitSize?: number;
  paidUnitLabel?: string;
  monthlyUsed?: number; // total usage this month (cost basis)
  estimatedCost?: number; // estimated overage cost for this metric
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
  instanceLabel: string; // e.g. 'database', 'bucket', 'namespace', 'script'
  instances: InstanceUsage[];
}

export interface AccountPlan {
  workersPaid: boolean;
  r2Paid: boolean;
  plans: string[];
  accessible: boolean; // false when the token can't read billing (e.g. OAuth)
}

export interface DashboardData {
  summaries: BillingSummary[];
  dailyUsage: UsageMetric[];
  freeTierStatus: FreeTierStatus[];
  plan?: AccountPlan;
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
  paidShare?: number; // fraction of the paid-plan allowance this instance uses
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

export interface AlertSetting {
  id: string;
  workspaceId: string;
  product: string;
  thresholdPercentage: number;
  slackWebhookUrl: string | null;
  emailAddress: string | null;
  enabled: boolean;
}
