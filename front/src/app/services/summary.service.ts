import { Injectable } from '@angular/core';
import { forkJoin, Observable, of, catchError, map } from 'rxjs';
import { IncomeService } from './income.service';
import { ExpenseService } from './expense.service';
import { Income } from '../models/income.model';
import { Expense } from '../models/expense.model';

export interface SummaryMovement {
  id: number;
  fecha: string;
  descripcion: string;
  categoria: string;
  tipo: 'ingreso' | 'gasto';
  monto: number;
  debt_id: number | null;
}

export interface CategoryBreakdown {
  categoria: string;
  total: number;
  cantidad: number;
  porcentaje: number;
}

export interface SummaryTotals {
  totalIngresos: number;
  totalGastos: number;
  neto: number;
  cantidadIngresos: number;
  cantidadGastos: number;
  promedioIngresos: number;
  promedioGastos: number;
}

export interface SummaryResult {
  movements: SummaryMovement[];
  totals: SummaryTotals;
  breakdownIngresos: CategoryBreakdown[];
  breakdownGastos: CategoryBreakdown[];
}

@Injectable({ providedIn: 'root' })
export class SummaryService {
  constructor(
    private incomeService: IncomeService,
    private expenseService: ExpenseService
  ) {}

  /**
   * Carga todos los movimientos del rango y arma los totales y desglose.
   * Si no se pasa rango, trae todo el historial.
   */
  load(fechaDesde?: string, fechaHasta?: string): Observable<SummaryResult> {
    const filters = { fechaDesde, fechaHasta };

    return forkJoin({
      incomes: this.incomeService.getAll(filters).pipe(catchError(() => of([] as Income[]))),
      expenses: this.expenseService.getAll(filters).pipe(catchError(() => of([] as Expense[]))),
    }).pipe(
      map(({ incomes, expenses }) => {
        const movements: SummaryMovement[] = [
          ...incomes.map((i) => ({
            id: i.id,
            fecha: i.fecha,
            descripcion: i.descripcion || 'Sin descripción',
            categoria: i.categoria || 'Otro',
            tipo: 'ingreso' as const,
            monto: typeof i.monto === 'number' ? i.monto : parseFloat(String(i.monto)) || 0,
            debt_id: null,
          })),
          ...expenses.map((e) => ({
            id: e.id,
            fecha: e.fecha,
            descripcion: e.descripcion || 'Sin descripción',
            categoria: e.categoria || 'Otro',
            tipo: 'gasto' as const,
            monto: typeof e.monto === 'number' ? e.monto : parseFloat(String(e.monto)) || 0,
            debt_id: e.debt_id ?? null,
          })),
        ].sort((a, b) => {
          const cmp = String(b.fecha).localeCompare(String(a.fecha));
          return cmp !== 0 ? cmp : b.id - a.id;
        });

        return {
          movements,
          totals: this.computeTotals(movements),
          breakdownIngresos: this.computeBreakdown(movements, 'ingreso'),
          breakdownGastos: this.computeBreakdown(movements, 'gasto'),
        };
      })
    );
  }

  private computeTotals(movements: SummaryMovement[]): SummaryTotals {
    let totalIngresos = 0;
    let totalGastos = 0;
    let cantidadIngresos = 0;
    let cantidadGastos = 0;

    for (const m of movements) {
      if (m.tipo === 'ingreso') {
        totalIngresos += m.monto;
        cantidadIngresos++;
      } else {
        totalGastos += m.monto;
        cantidadGastos++;
      }
    }

    return {
      totalIngresos,
      totalGastos,
      neto: totalIngresos - totalGastos,
      cantidadIngresos,
      cantidadGastos,
      promedioIngresos: cantidadIngresos > 0 ? totalIngresos / cantidadIngresos : 0,
      promedioGastos: cantidadGastos > 0 ? totalGastos / cantidadGastos : 0,
    };
  }

  private computeBreakdown(
    movements: SummaryMovement[],
    tipo: 'ingreso' | 'gasto'
  ): CategoryBreakdown[] {
    const map = new Map<string, { total: number; cantidad: number }>();
    let granTotal = 0;

    for (const m of movements) {
      if (m.tipo !== tipo) continue;
      const entry = map.get(m.categoria) || { total: 0, cantidad: 0 };
      entry.total += m.monto;
      entry.cantidad++;
      map.set(m.categoria, entry);
      granTotal += m.monto;
    }

    const result: CategoryBreakdown[] = [];
    for (const [categoria, { total, cantidad }] of map.entries()) {
      result.push({
        categoria,
        total,
        cantidad,
        porcentaje: granTotal > 0 ? (total / granTotal) * 100 : 0,
      });
    }

    result.sort((a, b) => b.total - a.total);
    return result;
  }
}