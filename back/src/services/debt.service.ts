import { IDebt, IDebtPayment, DebtStatus, InterestPeriod } from '../models/debt.model';

const round2 = (v: number): number => Math.round((Number(v) + 1e-9) * 100) / 100;
const round1 = (v: number): number => Math.round((Number(v) + 1e-9) * 10) / 10;

export function parseDateLocal(dateStr: string): Date {
  const parts = String(dateStr).split('T')[0].split('-');
  if (parts.length >= 3) {
    return new Date(
      parseInt(parts[0], 10),
      parseInt(parts[1], 10) - 1,
      parseInt(parts[2], 10)
    );
  }
  return new Date(dateStr);
}

export function isDateStringValid(dateStr: any): boolean {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const d = parseDateLocal(dateStr);
  return !isNaN(d.getTime());
}

export function formatDateForBackend(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function calculatePeriods(
  startDate: Date,
  endDate: Date,
  period: InterestPeriod | string
): number {
  if (!startDate || !endDate || isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return 0;
  if (endDate.getTime() <= startDate.getTime()) return 0;

  const days = Math.floor((endDate.getTime() - startDate.getTime()) / 86400000);

  switch (period) {
    case 'daily':
      return days;
    case 'biweekly':
      return Math.floor(days / 15);
    case 'monthly': {
      let months =
        (endDate.getFullYear() - startDate.getFullYear()) * 12 +
        (endDate.getMonth() - startDate.getMonth());
      if (endDate.getDate() < startDate.getDate()) months--;
      return Math.max(0, months);
    }
    default:
      return 0;
  }
}

export interface DebtState {
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
  status: DebtStatus;
}

/**
 * Calcula el estado derivado completo de una deuda a una fecha de referencia.
 * Solo cuenta los pagos cuya fecha sea <= asOf. Es la base para:
 *  - Mostrar la deuda en la UI (asOf = hoy)
 *  - Validar el monto de un pago nuevo (asOf = fecha del pago, con los pagos anteriores)
 */
export function calculateDebtState(
  debt: IDebt,
  payments: IDebtPayment[],
  asOf: Date
): DebtState {
  const original = round2(debt.original_amount);
  const rate = round2(debt.interest_rate);

  // 1) Filtrar solo pagos hasta la fecha de referencia.
  const paymentsUpTo = payments.filter((p) => {
    const f = parseDateLocal(p.fecha);
    return !isNaN(f.getTime()) && f.getTime() <= asOf.getTime();
  });

  // 2) Aplicar los pagos cronológicamente. Cada pago reduce primero capital.
  let capitalPaid = 0;
  let interestPaid = 0;
  let totalPaid = 0;

  const sorted = [...paymentsUpTo].sort((a, b) => {
    const byDate = String(a.fecha).localeCompare(String(b.fecha));
    return byDate !== 0 ? byDate : Number(a.id) - Number(b.id);
  });

  for (const p of sorted) {
    const amount = round2(p.amount);
    const remCap = Math.max(0, original - capitalPaid);
    const toCap = Math.min(amount, remCap);
    const toInt = round2(amount - toCap);
    capitalPaid = round2(capitalPaid + toCap);
    interestPaid = round2(interestPaid + toInt);
    totalPaid = round2(totalPaid + amount);
  }

  // 3) Fecha de corte para intereses. Si ya se pagó el capital, se corta en
  //    interest_stop_date; si no, hasta la fecha de referencia.
  let accrualEnd: Date = asOf;
  if (debt.interest_stop_date) {
    const stop = parseDateLocal(debt.interest_stop_date);
    if (!isNaN(stop.getTime()) && stop.getTime() < accrualEnd.getTime()) {
      accrualEnd = stop;
    }
  }

  const periods = calculatePeriods(
    parseDateLocal(debt.start_date),
    accrualEnd,
    debt.interest_period
  );

  const interestGenerated = debt.interest_enabled
    ? round2(original * (rate / 100) * periods)
    : 0;

  const capitalPending = Math.max(0, round2(original - capitalPaid));
  const interestPending = Math.max(0, round2(interestGenerated - interestPaid));
  const totalPending = round2(capitalPending + interestPending);
  const totalCurrent = round2(original + interestGenerated);
  const percentage =
    totalCurrent > 0 ? Math.min(100, round1((totalPaid / totalCurrent) * 100)) : 0;

  let status: DebtStatus;
  if (capitalPending > 0) status = 'activa';
  else if (interestPending > 0) status = 'capital_pagado';
  else status = 'pagada';

  return {
    interest_generated: interestGenerated,
    capital_paid: capitalPaid,
    interest_paid: interestPaid,
    capital_pending: capitalPending,
    interest_pending: interestPending,
    total_pending: totalPending,
    total_paid: totalPaid,
    total_current: totalCurrent,
    percentage,
    periodos_transcurridos: periods,
    status,
  };
}

export function hydrateDebt(
  debt: IDebt,
  payments: IDebtPayment[],
  asOf: Date = new Date()
): IDebt & DebtState & { payments: IDebtPayment[] } {
  const state = calculateDebtState(debt, payments, asOf);
  return { ...debt, ...state, payments };
}

export function validatePaymentChain(
  debt: IDebt,
  payments: IDebtPayment[]
): { valid: true } | { valid: false; message: string } {
  const sorted = [...payments].sort((a, b) => {
    const byDate = String(a.fecha).localeCompare(String(b.fecha));
    return byDate !== 0 ? byDate : Number(a.id) - Number(b.id);
  });

  const applied: IDebtPayment[] = [];
  for (const p of sorted) {
    const state = calculateDebtState(debt, applied, parseDateLocal(p.fecha));
    const amount = round2(Number(p.amount));
    if (amount > state.total_pending + 0.01) {
      return {
        valid: false,
        message:
          `El pago del ${String(p.fecha).split('T')[0]} por Q${amount.toFixed(2)} ` +
          `supera el total pendiente a esa fecha (Q${state.total_pending.toFixed(2)}). ` +
          `Revise los pagos posteriores.`,
      };
    }
    applied.push(p);
  }

  return { valid: true };
}