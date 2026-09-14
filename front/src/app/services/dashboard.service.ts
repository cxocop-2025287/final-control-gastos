import { Injectable } from '@angular/core';
import { Observable, forkJoin, map, catchError, of } from 'rxjs';
import { IncomeService } from './income.service';
import { ExpenseService } from './expense.service';
import { DebtService } from './debt.service';
import { DebtProgress, EMPTY_DEBT_PROGRESS } from '../models/debt.model';

export interface DashboardSummary {
  saldoTotal: number;
  ingreso: number;
  gasto: number;
  ahorroMensual: number;
}

export interface Movement {
  id: number;
  fecha: string;
  descripcion: string;
  categoria: string;
  tipo: 'ingreso' | 'gasto';
  monto: number;
}

export interface ChartPoint {
  mes: string;
  /** Saldo acumulado al cierre de la semana. `null` si la semana aún no ha llegado. */
  valor: number | null;
  /** Ingresos de la semana. `null` si la semana aún no ha llegado. */
  ingresos: number | null;
  /** Gastos de la semana. `null` si la semana aún no ha llegado. */
  gastos: number | null;
}
@Injectable({ providedIn: 'root' })
export class DashboardService {
  constructor(
    private incomeService: IncomeService,
    private expenseService: ExpenseService,
    private debtService: DebtService
  ) {}

  loadDashboardData(): Observable<{
    summary: DashboardSummary;
    movements: Movement[];
    chartData: ChartPoint[];
    debtProgress: DebtProgress;
  }> {
    const hoy = new Date();
    const primerDiaMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const ultimoDiaMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);

    const primerDiaMesAnt = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
    const ultimoDiaMesAnt = new Date(hoy.getFullYear(), hoy.getMonth(), 0);

    const fechaDesde = this.formatDateForBackend(primerDiaMes);
    const fechaHasta = this.formatDateForBackend(ultimoDiaMes);

    const fechaDesdeAnt = this.formatDateForBackend(primerDiaMesAnt);
    const fechaHastaAnt = this.formatDateForBackend(ultimoDiaMesAnt);

    const emptySummary = { total: 0, count: 0, average: 0 };

    console.log(`📅 Dashboard - Consultando mes actual (${fechaDesde} a ${fechaHasta})`);

    return forkJoin({
      // Balance TOTAL hasta hoy (lo usamos para el summary y para el saldo inicial de la gráfica)
      balance: this.expenseService.getBalance().pipe(catchError(() => of({ balance: 0 }))),
      currentIncomes: this.incomeService.getAll({ fechaDesde, fechaHasta }),
      currentExpenses: this.expenseService.getAll({ fechaDesde, fechaHasta }),
      // Necesitamos TODOS los movimientos hasta el final del mes actual para
      // reconstruir la serie acumulada semana a semana.
      allIncomes: this.incomeService.getAll({ fechaHasta }).pipe(catchError(() => of([]))),
      allExpenses: this.expenseService.getAll({ fechaHasta }).pipe(catchError(() => of([]))),
      lastMonthIncomes: this.incomeService
        .getSummary(fechaDesdeAnt, fechaHastaAnt)
        .pipe(catchError(() => of(emptySummary))),
      lastMonthExpenses: this.expenseService
        .getSummary(fechaDesdeAnt, fechaHastaAnt)
        .pipe(catchError(() => of(emptySummary))),
      debtProgress: this.debtService.getProgress().pipe(catchError(() => of(EMPTY_DEBT_PROGRESS))),
    }).pipe(
      map(({ balance, currentIncomes, currentExpenses, allIncomes, allExpenses, lastMonthIncomes, lastMonthExpenses, debtProgress }) => {
        const validIncomes = currentIncomes.map(inc => ({
          ...inc,
          monto: typeof inc.monto === 'number' ? inc.monto : parseFloat(String(inc.monto)) || 0,
        }));

        const validExpenses = currentExpenses.map(exp => ({
          ...exp,
          monto: typeof exp.monto === 'number' ? exp.monto : parseFloat(String(exp.monto)) || 0,
        }));

        const totalIngresos = validIncomes.reduce((sum, inc) => sum + inc.monto, 0);
        const totalGastos = validExpenses.reduce((sum, exp) => sum + exp.monto, 0);

        const ahorroMesAnterior =
          (Number(lastMonthIncomes.total) || 0) - (Number(lastMonthExpenses.total) || 0);

        const movements: Movement[] = [
          ...validIncomes.map(inc => ({
            id: inc.id,
            fecha: inc.fecha,
            descripcion: inc.descripcion || 'Sin descripción',
            categoria: inc.categoria || 'Otro',
            tipo: 'ingreso' as const,
            monto: inc.monto,
          })),
          ...validExpenses.map(exp => ({
            id: exp.id,
            fecha: exp.fecha,
            descripcion: exp.descripcion || 'Sin descripción',
            categoria: exp.categoria || 'Otro',
            tipo: 'gasto' as const,
            monto: exp.monto,
          })),
        ].sort((a, b) => {
          const cmpFecha = String(b.fecha).localeCompare(String(a.fecha));
          if (cmpFecha !== 0) return cmpFecha;
          return Number(b.id) - Number(a.id);
        });

        // Construimos la serie acumulada del mes actual.
        const weeks = this.buildCumulativeWeeks(
          allIncomes.map(i => ({
            id: i.id,
            fecha: i.fecha,
            monto: typeof i.monto === 'number' ? i.monto : parseFloat(String(i.monto)) || 0,
            tipo: 'ingreso' as const,
          })),
          allExpenses.map(e => ({
            id: e.id,
            fecha: e.fecha,
            monto: typeof e.monto === 'number' ? e.monto : parseFloat(String(e.monto)) || 0,
            tipo: 'gasto' as const,
          })),
          hoy
        );

        const saldoTotal =
          typeof balance.balance === 'number'
            ? balance.balance
            : parseFloat(String(balance.balance)) || 0;

        const summary: DashboardSummary = {
          saldoTotal,
          ingreso: totalIngresos,
          gasto: totalGastos,
          ahorroMensual: ahorroMesAnterior,
        };

        return { summary, movements, chartData: weeks, debtProgress };
      })
    );
  }

  private formatDateForBackend(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private parseDateLocal(dateStr: string): Date {
    if (!dateStr) return new Date(NaN);
    const parts = String(dateStr).split('T')[0].split('-');
    if (parts.length < 3) return new Date(dateStr);
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    return new Date(y, m, d);
  }

  /**
   * Construye 4 puntos que representan el SALDO ACUMULADO al cierre de cada
   * semana del mes actual.
   *
   *  - El saldo inicial es el acumulado antes del día 1 del mes (todas las
   *    transacciones anteriores).
   *  - Cada semana suma los ingresos y resta los gastos de esa semana.
   *  - El valor resultante es el saldo real en ese momento y NUNCA es negativo,
   *    porque el sistema impide gastar más de lo disponible.
   */
  private buildCumulativeWeeks(
  allIncomes: { id: number; fecha: string; monto: number; tipo: 'ingreso' }[],
  allExpenses: { id: number; fecha: string; monto: number; tipo: 'gasto' }[],
  today: Date
): ChartPoint[] {
  const year = today.getFullYear();
  const month = today.getMonth();
  const currentDay = today.getDate();
  const currentWeek = Math.min(Math.ceil(currentDay / 7), 4);

  const all: { fecha: string; monto: number; tipo: 'ingreso' | 'gasto' }[] = [
    ...allIncomes.map(i => ({ fecha: i.fecha, monto: i.monto, tipo: i.tipo })),
    ...allExpenses.map(e => ({ fecha: e.fecha, monto: e.monto, tipo: e.tipo })),
  ];

  // Saldo inicial = todo lo anterior al primer día del mes actual.
  let saldo = 0;
  for (const m of all) {
    const d = this.parseDateLocal(m.fecha);
    if (isNaN(d.getTime())) continue;
    if (d.getFullYear() < year || (d.getFullYear() === year && d.getMonth() < month)) {
      saldo += m.tipo === 'ingreso' ? m.monto : -m.monto;
    }
  }

  // Delats por semana (4 siempre).
  const weekDelta: { ingresos: number; gastos: number }[] = [
    { ingresos: 0, gastos: 0 },
    { ingresos: 0, gastos: 0 },
    { ingresos: 0, gastos: 0 },
    { ingresos: 0, gastos: 0 },
  ];

  for (const m of all) {
    const d = this.parseDateLocal(m.fecha);
    if (isNaN(d.getTime())) continue;
    if (d.getFullYear() !== year || d.getMonth() !== month) continue;

    const weekIndex = Math.min(Math.ceil(d.getDate() / 7) - 1, 3);
    if (m.tipo === 'ingreso') weekDelta[weekIndex].ingresos += m.monto;
    else weekDelta[weekIndex].gastos += m.monto;
  }

  const labels = ['Semana 1', 'Semana 2', 'Semana 3', 'Semana 4'];
  const result: ChartPoint[] = [];

  for (let i = 0; i < 4; i++) {
    // Si la semana aún no ha llegado, devolvemos null para no dibujar punto.
    if (i >= currentWeek) {
      result.push({ mes: labels[i], valor: null, ingresos: null, gastos: null });
      continue;
    }
    saldo += weekDelta[i].ingresos - weekDelta[i].gastos;
    if (saldo < 0) saldo = 0;
    result.push({
      mes: labels[i],
      valor: saldo,
      ingresos: weekDelta[i].ingresos,
      gastos: weekDelta[i].gastos,
    });
  }

  return result;
}

  getSummary(): DashboardSummary {
    return { saldoTotal: 0, ingreso: 0, gasto: 0, ahorroMensual: 0 };
  }

  getRecentMovements(): Movement[] {
    return [];
  }

  getChartData(): ChartPoint[] {
    return [];
  }
}