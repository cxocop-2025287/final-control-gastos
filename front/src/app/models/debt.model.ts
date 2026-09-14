export interface DebtPayment {
  id: number;
  debt_id: number;
  amount: number;
  fecha: string;
  expense_id: number | null;
  created_at: string;
}

export interface Debt {
  id: number;
  user_id: number;
  name: string;
  creditor: string;
  original_amount: number;
  paid_amount: number;
  interest_enabled: boolean;
  interest_rate: number;
  interest_period: 'daily' | 'biweekly' | 'monthly';
  start_date: string;
  interest_stop_date: string | null;
  status: 'activa' | 'capital_pagado' | 'pagada';
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  // Valores derivados (calculados por el backend, nunca almacenados)
  interest_generated: number;
  capital_paid: number;
  interest_paid: number;
  capital_pending: number;
  interest_pending: number;
  total_pending: number;
  total_paid: number;
  total_current: number;
  percentage: number;
  periodos_transcurridos: number;
  payments: DebtPayment[];
}

export interface DebtCreate {
  name: string;
  creditor: string;
  original_amount: number;
  interest_enabled: boolean;
  interest_rate: number;
  interest_period: 'daily' | 'biweekly' | 'monthly';
  start_date: string;
}

export interface DebtPaymentCreate {
  monto: number;
  fecha: string;
}

export interface DebtProgress {
  total: number;
  pagado: number;
  restante: number;
  porcentaje: number;
  deudas: { id: number; nombre: string; total: number; pagado: number }[];
}

export const INTEREST_PERIODS = ['daily', 'biweekly', 'monthly'] as const;

export const DEBT_STATUSES = ['activa', 'capital_pagado', 'pagada'] as const;

export const PERIOD_LABELS: Record<string, string> = {
  daily: 'Diario',
  biweekly: 'Quincenal',
  monthly: 'Mensual',
};

export const STATUS_LABELS: Record<string, string> = {
  activa: 'Activa',
  capital_pagado: 'Capital pagado',
  pagada: 'Pagada',
};

export const EMPTY_DEBT_PROGRESS: DebtProgress = {
  total: 0,
  pagado: 0,
  restante: 0,
  porcentaje: 0,
  deudas: [],
};