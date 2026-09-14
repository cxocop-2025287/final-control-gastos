export interface Expense {
  id: number;
  user_id: number;
  fecha: string;
  descripcion: string;
  categoria: 'Comida' | 'Transporte' | 'Vivienda' | 'Salud' | 'Educación' | 'Ocio' | 'Otro' | 'Deudas';
  monto: number;
  debt_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface ExpenseCreate {
  fecha: string;
  descripcion: string;
  categoria: string;
  monto: number;
  debt_id?: number | null;
}

export interface ExpenseSummary {
  total: number;
  count: number;
  average: number;
}

export const EXPENSE_CATEGORIES = [
  'Comida',
  'Transporte',
  'Vivienda',
  'Salud',
  'Educación',
  'Ocio',
  'Otro',
  'Deudas',
] as const;
export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number];