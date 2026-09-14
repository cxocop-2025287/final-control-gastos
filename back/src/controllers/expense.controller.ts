import { Request, Response } from 'express';
import { ExpenseModel, IExpenseCreate, EXPENSE_CATEGORIES } from '../models/expense.model';
import { DebtModel } from '../models/debt.model';
import { calculateDebtState } from '../services/debt.service';
import { IAuthRequest } from '../types/auth.types';

type ExpenseCategory = typeof EXPENSE_CATEGORIES[number];

export class ExpenseController {
  static async getAll(req: IAuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const { fechaDesde, fechaHasta, categoria } = req.query;

      const filters: any = {};
      if (fechaDesde && typeof fechaDesde === 'string') {
        filters.fechaDesde = fechaDesde.split('T')[0];
      }
      if (fechaHasta && typeof fechaHasta === 'string') {
        filters.fechaHasta = fechaHasta.split('T')[0];
      }
      if (categoria && typeof categoria === 'string') {
        const categoriaStr = categoria as string;
        if (EXPENSE_CATEGORIES.includes(categoriaStr as ExpenseCategory)) {
          filters.categoria = categoriaStr;
        }
      }

      const expenses = await ExpenseModel.findAll(userId, filters);
      res.status(200).json(expenses);
    } catch (error) {
      console.error('Error al obtener egresos:', error);
      res.status(500).json({ message: 'Error al obtener los egresos', errorCode: 'INTERNAL_ERROR' });
    }
  }

  static async getSummary(req: IAuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const { fechaDesde, fechaHasta } = req.query;

      if (!fechaDesde || !fechaHasta) {
        res.status(400).json({ message: 'Se requieren fechaDesde y fechaHasta', errorCode: 'MISSING_PARAMS' });
        return;
      }

      const summary = await ExpenseModel.getSummary(
        userId,
        String(fechaDesde).split('T')[0],
        String(fechaHasta).split('T')[0]
      );

      res.status(200).json(summary);
    } catch (error) {
      console.error('Error al obtener resumen:', error);
      res.status(500).json({ message: 'Error al obtener el resumen', errorCode: 'INTERNAL_ERROR' });
    }
  }

  static async getBalance(req: IAuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const balance = await ExpenseModel.getBalance(userId);
      res.status(200).json({ balance });
    } catch (error) {
      console.error('Error al obtener saldo disponible:', error);
      res.status(500).json({ message: 'Error al obtener el saldo disponible', errorCode: 'INTERNAL_ERROR' });
    }
  }

  static async create(req: IAuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const { fecha, descripcion, categoria, monto, debt_id } = req.body;

      if (!fecha || !descripcion || !categoria || monto === undefined) {
        res.status(400).json({ message: 'Todos los campos son obligatorios', errorCode: 'MISSING_FIELDS' });
        return;
      }

      if (typeof categoria !== 'string' || !EXPENSE_CATEGORIES.includes(categoria as ExpenseCategory)) {
        res.status(400).json({
          message: `Categoría inválida. Debe ser: ${EXPENSE_CATEGORIES.join(', ')}`,
          errorCode: 'INVALID_CATEGORY',
        });
        return;
      }

      const montoNum = typeof monto === 'string' ? parseFloat(monto) : monto;
      if (typeof montoNum !== 'number' || isNaN(montoNum) || montoNum <= 0) {
        res.status(400).json({ message: 'El monto debe ser un número mayor a 0', errorCode: 'INVALID_AMOUNT' });
        return;
      }

      const fechaStr = String(fecha).split('T')[0];

      // Si viene debt_id, verificar que la deuda exista y pertenezca al usuario.
      let debtIdNum: number | null = null;
      if (debt_id !== undefined && debt_id !== null && debt_id !== '') {
        const parsed = typeof debt_id === 'string' ? parseInt(debt_id, 10) : Number(debt_id);
        if (isNaN(parsed)) {
          res.status(400).json({ message: 'debt_id inválido', errorCode: 'INVALID_DEBT_ID' });
          return;
        }
        debtIdNum = parsed;
        const debt = await DebtModel.findById(debtIdNum, userId);
        if (!debt || debt.deleted_at) {
          res.status(404).json({ message: 'Deuda no encontrada', errorCode: 'DEBT_NOT_FOUND' });
          return;
        }
      }

      // Validación temporal: el gasto no puede dejar el saldo histórico
      // en negativo en ningún punto del tiempo.
      const check = await ExpenseModel.validateTimeSeriesBalance(userId, {
        type: 'create',
        fecha: fechaStr,
        monto: montoNum,
      });
      if (!check.ok) {
        res.status(400).json({
          message: `Saldo insuficiente a esa fecha. El saldo quedaría en Q${check.balance.toFixed(2)} el ${check.at}.`,
          errorCode: 'INSUFFICIENT_BALANCE',
        });
        return;
      }

      const expenseData: IExpenseCreate = {
        fecha: fechaStr,
        descripcion: descripcion.trim(),
        categoria: categoria as ExpenseCategory,
        monto: montoNum,
        debt_id: debtIdNum,
      };

      const created = await ExpenseModel.create(userId, expenseData);
      res.status(201).json(created);
    } catch (error) {
      console.error('Error al crear egreso:', error);
      res.status(500).json({ message: 'Error al crear el egreso', errorCode: 'INTERNAL_ERROR' });
    }
  }

  static async update(req: IAuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const idParam = req.params.id;
      const id = typeof idParam === 'string' ? parseInt(idParam, 10) : NaN;

      if (isNaN(id)) {
        res.status(400).json({ message: 'ID inválido', errorCode: 'INVALID_ID' });
        return;
      }

      const { fecha, descripcion, categoria, monto } = req.body;

      const current = await ExpenseModel.findById(id, userId);
      if (!current) {
        res.status(404).json({ message: 'Egreso no encontrado', errorCode: 'EXPENSE_NOT_FOUND' });
        return;
      }

      // --- Caso especial: gasto de pago de deuda ---
      if (current.debt_id) {
        const onlyDescription =
          (monto === undefined || Number(monto) === Number(current.monto)) &&
          (fecha === undefined || String(fecha).split('T')[0] === String(current.fecha).split('T')[0]) &&
          (categoria === undefined || categoria === current.categoria);

        if (onlyDescription) {
          const updated = await ExpenseModel.update(id, userId, {
            descripcion: descripcion !== undefined ? descripcion.trim() : undefined,
          });
          if (!updated) {
            res.status(404).json({ message: 'Egreso no encontrado', errorCode: 'EXPENSE_NOT_FOUND' });
            return;
          }
          res.status(200).json(updated);
          return;
        }

        const payments = await DebtModel.listPaymentsByDebt(current.debt_id, userId);
        const linked = payments.find((p) => p.expense_id === current.id);
        if (!linked) {
          res.status(400).json({
            message: 'El gasto está vinculado a una deuda pero no se encontró su pago. Elimine el gasto y regístrelo de nuevo.',
            errorCode: 'PAYMENT_NOT_FOUND',
          });
          return;
        }

        const nuevoMonto =
          monto !== undefined
            ? (typeof monto === 'string' ? parseFloat(monto) : monto)
            : Number(linked.amount);
        const nuevaFecha =
          fecha !== undefined
            ? String(fecha).split('T')[0]
            : String(linked.fecha).split('T')[0];

        const debt = await DebtModel.findById(current.debt_id, userId);
        if (!debt) {
          res.status(404).json({ message: 'Deuda no encontrada', errorCode: 'DEBT_NOT_FOUND' });
          return;
        }

        if (typeof nuevoMonto !== 'number' || isNaN(nuevoMonto) || nuevoMonto <= 0) {
          res.status(400).json({ message: 'El monto debe ser un número mayor a 0', errorCode: 'INVALID_AMOUNT' });
          return;
        }
        const hoy = new Date().toISOString().split('T')[0];
        if (nuevaFecha > hoy) {
          res.status(400).json({ message: 'La fecha no puede ser futura', errorCode: 'INVALID_DATE' });
          return;
        }
        if (nuevaFecha < debt.start_date) {
          res.status(400).json({
            message: 'La fecha no puede ser anterior al inicio de la deuda',
            errorCode: 'INVALID_DATE',
          });
          return;
        }

        // Validación temporal del gasto asociado al pago.
        const check = await ExpenseModel.validateTimeSeriesBalance(userId, {
          type: 'update',
          id: current.id,
          monto: nuevoMonto,
          fecha: nuevaFecha,
        });
        if (!check.ok) {
          res.status(400).json({
            message: `Este cambio dejaría el saldo en Q${check.balance.toFixed(2)} el ${check.at}.`,
            errorCode: 'INSUFFICIENT_BALANCE',
          });
          return;
        }

        const others = payments.filter((p) => p.id !== linked.id);
        const stateAtDate = calculateDebtState(debt, others, new Date(nuevaFecha + 'T00:00:00'));
        if (nuevoMonto > stateAtDate.total_pending) {
          res.status(400).json({
            message: `El monto no puede superar el total pendiente a esa fecha (Q${stateAtDate.total_pending.toFixed(2)})`,
            errorCode: 'PAYMENT_EXCEEDS_TOTAL',
          });
          return;
        }

        await DebtModel.updatePayment(linked.id, userId, { amount: nuevoMonto, fecha: nuevaFecha });

        const updated = await ExpenseModel.update(id, userId, {
          fecha: nuevaFecha,
          monto: nuevoMonto,
          descripcion: descripcion !== undefined ? descripcion.trim() : undefined,
        });

        const remaining = await DebtModel.listPaymentsByDebt(debt.id, userId);
        const freshDebt = await DebtModel.findById(debt.id, userId);
        if (freshDebt) {
          const newState = calculateDebtState(freshDebt, remaining, new Date());
          const updateData: any = { status: newState.status };
          if (newState.capital_pending > 0 && freshDebt.interest_stop_date) {
            updateData.interest_stop_date = null;
          }
          if (newState.capital_pending === 0 && !freshDebt.interest_stop_date) {
            const lastPayment = remaining[remaining.length - 1];
            updateData.interest_stop_date = lastPayment ? lastPayment.fecha : null;
          }
          await DebtModel.update(debt.id, userId, updateData);
        }

        res.status(200).json(updated);
        return;
      }

      // --- Caso normal ---
      const updateData: any = {};

      if (fecha !== undefined) updateData.fecha = String(fecha).split('T')[0];
      if (descripcion !== undefined) updateData.descripcion = descripcion.trim();

      if (categoria !== undefined) {
        if (typeof categoria !== 'string' || !EXPENSE_CATEGORIES.includes(categoria as ExpenseCategory)) {
          res.status(400).json({
            message: `Categoría inválida. Debe ser: ${EXPENSE_CATEGORIES.join(', ')}`,
            errorCode: 'INVALID_CATEGORY',
          });
          return;
        }
        updateData.categoria = categoria;
      }

      let nuevoMonto: number | undefined;
      if (monto !== undefined) {
        const montoNum = typeof monto === 'string' ? parseFloat(monto) : monto;
        if (typeof montoNum !== 'number' || isNaN(montoNum) || montoNum <= 0) {
          res.status(400).json({ message: 'El monto debe ser un número mayor a 0', errorCode: 'INVALID_AMOUNT' });
          return;
        }
        updateData.monto = montoNum;
        nuevoMonto = montoNum;
      }

      // Validación temporal (solo si cambia monto o fecha).
      if (nuevoMonto !== undefined || fecha !== undefined) {
        const fechaFinal =
          fecha !== undefined
            ? String(fecha).split('T')[0]
            : String(current.fecha).split('T')[0];
        const montoFinal =
          nuevoMonto !== undefined ? nuevoMonto : Number(current.monto);

        const check = await ExpenseModel.validateTimeSeriesBalance(userId, {
          type: 'update',
          id,
          monto: montoFinal,
          fecha: fechaFinal,
        });
        if (!check.ok) {
          res.status(400).json({
            message: `Este cambio dejaría el saldo en Q${check.balance.toFixed(2)} el ${check.at}.`,
            errorCode: 'INSUFFICIENT_BALANCE',
          });
          return;
        }
      }

      const updated = await ExpenseModel.update(id, userId, updateData);

      if (!updated) {
        res.status(404).json({ message: 'Egreso no encontrado', errorCode: 'EXPENSE_NOT_FOUND' });
        return;
      }

      res.status(200).json(updated);
    } catch (error) {
      console.error('Error al actualizar egreso:', error);
      res.status(500).json({ message: 'Error al actualizar el egreso', errorCode: 'INTERNAL_ERROR' });
    }
  }

  static async delete(req: IAuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const idParam = req.params.id;
      const id = typeof idParam === 'string' ? parseInt(idParam, 10) : NaN;

      if (isNaN(id)) {
        res.status(400).json({ message: 'ID inválido', errorCode: 'INVALID_ID' });
        return;
      }

      const existing = await ExpenseModel.findById(id, userId);
      if (!existing) {
        res.status(404).json({ message: 'Egreso no encontrado', errorCode: 'EXPENSE_NOT_FOUND' });
        return;
      }

      // Si el gasto proviene de un pago de deuda, eliminar también el debt_payment
      // y recalcular el estado de la deuda.
      if (existing.debt_id) {
        try {
          const payments = await DebtModel.listPaymentsByDebt(existing.debt_id, userId);
          const linked = payments.find((p) => p.expense_id === existing.id);

          if (linked) {
            await DebtModel.deletePayment(linked.id, userId);
          }

          const debt = await DebtModel.findById(existing.debt_id, userId);
          if (debt) {
            const remaining = await DebtModel.listPaymentsByDebt(debt.id, userId);
            const newState = calculateDebtState(debt, remaining, new Date());
            const updateData: any = { status: newState.status };
            if (newState.capital_pending > 0 && debt.interest_stop_date) {
              updateData.interest_stop_date = null;
            }
            if (newState.capital_pending === 0 && !debt.interest_stop_date) {
              const lastPayment = remaining[remaining.length - 1];
              const today = new Date();
              const yyyy = today.getFullYear();
              const mm = String(today.getMonth() + 1).padStart(2, '0');
              const dd = String(today.getDate()).padStart(2, '0');
              updateData.interest_stop_date = lastPayment ? lastPayment.fecha : `${yyyy}-${mm}-${dd}`;
            }
            await DebtModel.update(debt.id, userId, updateData);
          }
        } catch (e) {
          console.warn('No se pudo limpiar el pago de deuda asociado:', e);
        }
      }

      const deleted = await ExpenseModel.delete(id, userId);

      if (!deleted) {
        res.status(404).json({ message: 'Egreso no encontrado', errorCode: 'EXPENSE_NOT_FOUND' });
        return;
      }

      res.status(200).json({ message: 'Egreso eliminado correctamente' });
    } catch (error) {
      console.error('Error al eliminar egreso:', error);
      res.status(500).json({ message: 'Error al eliminar el egreso', errorCode: 'INTERNAL_ERROR' });
    }
  }

  static async getCategories(req: Request, res: Response): Promise<void> {
    res.status(200).json(EXPENSE_CATEGORIES);
  }
}