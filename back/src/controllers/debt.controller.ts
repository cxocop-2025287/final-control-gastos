import { Response } from 'express';
import {
  DebtModel,
  IDebt,
  IDebtPayment,
  INTEREST_PERIODS,
  InterestPeriod,
  DebtStatus,
} from '../models/debt.model';
import { ExpenseModel } from '../models/expense.model';
import {
  hydrateDebt,
  calculateDebtState,
  validatePaymentChain,
  isDateStringValid,
  parseDateLocal,
  formatDateForBackend,
} from '../services/debt.service';
import { IAuthRequest } from '../types/auth.types';

const toNum = (v: any): number => (typeof v === 'string' ? parseFloat(v) : v) as number;
const round2 = (v: number): number => Math.round((Number(v) + 1e-9) * 100) / 100;

const isInterestPeriod = (v: any): v is InterestPeriod =>
  typeof v === 'string' && (INTEREST_PERIODS as readonly string[]).includes(v);

function todayString(): string {
  return formatDateForBackend(new Date());
}

function normalizeFecha(fecha: any): string {
  return String(fecha).split('T')[0];
}

async function buildPaymentsByDebt(userId: number): Promise<Map<number, IDebtPayment[]>> {
  const all = await DebtModel.listAllPaymentsForUser(userId);
  const map = new Map<number, IDebtPayment[]>();
  for (const p of all) {
    if (!map.has(p.debt_id)) map.set(p.debt_id, []);
    map.get(p.debt_id)!.push(p);
  }
  return map;
}

function serializeDebt(debt: IDebt & Record<string, any>): any {
  const out: Record<string, any> = { ...debt };
  for (const key of [
    'original_amount',
    'interest_rate',
    'interest_generated',
    'capital_paid',
    'interest_paid',
    'capital_pending',
    'interest_pending',
    'total_pending',
    'total_paid',
    'total_current',
    'percentage',
  ]) {
    if (out[key] !== undefined) out[key] = round2(Number(out[key]));
  }
  if (out.periodos_transcurridos !== undefined) {
    out.periodos_transcurridos = Number(out.periodos_transcurridos);
  }
  return out;
}

export class DebtController {
  static async getAll(req: IAuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const onlyArchived = String(req.query.archivadas || '') === 'true';
      const debts = await DebtModel.findAll(userId, { onlyArchived });
      const paymentsByDebt = await buildPaymentsByDebt(userId);
      const result = debts.map((d) =>
        serializeDebt(hydrateDebt(d, paymentsByDebt.get(d.id) || []))
      );
      res.status(200).json(result);
    } catch (error) {
      console.error('Error al obtener deudas:', error);
      res.status(500).json({ message: 'Error al obtener las deudas', errorCode: 'INTERNAL_ERROR' });
    }
  }

  static async getById(req: IAuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const id = parseInt(String(req.params.id), 10);
      if (isNaN(id)) {
        res.status(400).json({ message: 'ID inválido', errorCode: 'INVALID_ID' });
        return;
      }
      const debt = await DebtModel.findById(id, userId);
      if (!debt || debt.deleted_at) {
        res.status(404).json({ message: 'Deuda no encontrada', errorCode: 'DEBT_NOT_FOUND' });
        return;
      }
      const payments = await DebtModel.listPaymentsByDebt(id, userId);
      res.status(200).json(serializeDebt(hydrateDebt(debt, payments)));
    } catch (error) {
      console.error('Error al obtener deuda:', error);
      res.status(500).json({ message: 'Error al obtener la deuda', errorCode: 'INTERNAL_ERROR' });
    }
  }

  static async create(req: IAuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const body = req.body || {};

      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const creditor = typeof body.creditor === 'string' ? body.creditor.trim() : '';
      const originalAmount = toNum(body.original_amount);
      const interestEnabled = body.interest_enabled === true;
      const interestRate = toNum(body.interest_rate ?? 0);
      const rawStart = body.start_date ?? todayString();
      const startDate = normalizeFecha(rawStart);

      if (!name) {
        res.status(400).json({ message: 'El nombre de la deuda es obligatorio', errorCode: 'INVALID_NAME' });
        return;
      }
      if (name.length > 100) {
        res.status(400).json({ message: 'El nombre no puede superar 100 caracteres', errorCode: 'INVALID_NAME' });
        return;
      }
      if (!creditor) {
        res.status(400).json({ message: 'El acreedor es obligatorio', errorCode: 'INVALID_CREDITOR' });
        return;
      }
      if (creditor.length > 100) {
        res.status(400).json({ message: 'El acreedor no puede superar 100 caracteres', errorCode: 'INVALID_CREDITOR' });
        return;
      }
      if (typeof originalAmount !== 'number' || isNaN(originalAmount) || originalAmount <= 0) {
        res.status(400).json({ message: 'El monto original debe ser un número mayor a 0', errorCode: 'INVALID_AMOUNT' });
        return;
      }
      if (interestEnabled) {
        if (typeof interestRate !== 'number' || isNaN(interestRate) || interestRate < 0) {
          res.status(400).json({ message: 'El porcentaje de interés debe ser mayor o igual a 0', errorCode: 'INVALID_RATE' });
          return;
        }
        if (!isInterestPeriod(body.interest_period)) {
          res.status(400).json({ message: 'El periodo de interés es inválido', errorCode: 'INVALID_PERIOD' });
          return;
        }
      }
      if (!isDateStringValid(startDate)) {
        res.status(400).json({ message: 'La fecha de inicio es inválida', errorCode: 'INVALID_DATE' });
        return;
      }
      if (parseDateLocal(startDate).getTime() > parseDateLocal(todayString()).getTime()) {
        res.status(400).json({ message: 'La fecha de inicio no puede ser futura', errorCode: 'INVALID_DATE' });
        return;
      }

      const interestPeriod: InterestPeriod = interestEnabled ? body.interest_period : 'monthly';

      const created = await DebtModel.create(userId, {
        name,
        creditor,
        original_amount: originalAmount,
        interest_enabled: interestEnabled,
        interest_rate: interestEnabled ? interestRate : 0,
        interest_period: interestPeriod,
        start_date: startDate,
        interest_stop_date: null,
        status: 'activa' as DebtStatus,
      });

      res.status(201).json(serializeDebt(hydrateDebt(created, [])));
    } catch (error) {
      console.error('Error al crear deuda:', error);
      res.status(500).json({ message: 'Error al crear la deuda', errorCode: 'INTERNAL_ERROR' });
    }
  }

  static async update(req: IAuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const id = parseInt(String(req.params.id), 10);
      if (isNaN(id)) {
        res.status(400).json({ message: 'ID inválido', errorCode: 'INVALID_ID' });
        return;
      }

      const current = await DebtModel.findById(id, userId);
      if (!current || current.deleted_at) {
        res.status(404).json({ message: 'Deuda no encontrada', errorCode: 'DEBT_NOT_FOUND' });
        return;
      }

      const payments = await DebtModel.listPaymentsByDebt(id, userId);
      const body = req.body || {};
      const updateData: any = {};

      if (body.name !== undefined) {
        const name = String(body.name).trim();
        if (!name) {
          res.status(400).json({ message: 'El nombre de la deuda es obligatorio', errorCode: 'INVALID_NAME' });
          return;
        }
        updateData.name = name;
      }
      if (body.creditor !== undefined) {
        const creditor = String(body.creditor).trim();
        if (!creditor) {
          res.status(400).json({ message: 'El acreedor es obligatorio', errorCode: 'INVALID_CREDITOR' });
          return;
        }
        updateData.creditor = creditor;
      }

      if (body.start_date !== undefined) {
        const startDate = normalizeFecha(body.start_date);
        if (!isDateStringValid(startDate)) {
          res.status(400).json({ message: 'La fecha de inicio es inválida', errorCode: 'INVALID_DATE' });
          return;
        }
        if (parseDateLocal(startDate).getTime() > parseDateLocal(todayString()).getTime()) {
          res.status(400).json({ message: 'La fecha de inicio no puede ser futura', errorCode: 'INVALID_DATE' });
          return;
        }
        updateData.start_date = startDate;
      }

      let interestEnabled = current.interest_enabled;
      if (body.interest_enabled !== undefined) {
        interestEnabled = body.interest_enabled === true;
        updateData.interest_enabled = interestEnabled;
      }
      if (body.interest_rate !== undefined || interestEnabled) {
        const interestRate = toNum(body.interest_rate ?? (interestEnabled ? current.interest_rate : 0));
        if (typeof interestRate !== 'number' || isNaN(interestRate) || interestRate < 0) {
          res.status(400).json({ message: 'El porcentaje de interés debe ser mayor o igual a 0', errorCode: 'INVALID_RATE' });
          return;
        }
        updateData.interest_rate = interestEnabled ? interestRate : 0;
      } else {
        updateData.interest_rate = 0;
      }
      if (body.interest_period !== undefined || interestEnabled) {
        if (body.interest_period !== undefined && !isInterestPeriod(body.interest_period)) {
          res.status(400).json({ message: 'El periodo de interés es inválido', errorCode: 'INVALID_PERIOD' });
          return;
        }
        updateData.interest_period = interestEnabled
          ? (body.interest_period ?? current.interest_period)
          : 'monthly';
      }
      if (!interestEnabled) {
        updateData.interest_rate = 0;
      }

      const newOriginal =
        body.original_amount !== undefined
          ? toNum(body.original_amount)
          : Number(current.original_amount);
      if (body.original_amount !== undefined) {
        if (typeof newOriginal !== 'number' || isNaN(newOriginal) || newOriginal <= 0) {
          res.status(400).json({ message: 'El monto original debe ser un número mayor a 0', errorCode: 'INVALID_AMOUNT' });
          return;
        }
      }

      const currentState = calculateDebtState(current, payments, new Date());
      const capitalPaidByPayments = round2(Math.max(0, currentState.capital_paid));

      if (newOriginal < capitalPaidByPayments) {
        res.status(400).json({
          message: `El monto original no puede ser menor al capital ya pagado (Q${capitalPaidByPayments.toFixed(2)})`,
          errorCode: 'INVALID_AMOUNT',
        });
        return;
      }
      if (newOriginal !== Number(current.original_amount)) {
        updateData.original_amount = newOriginal;
      }

      const isFullyPaid = capitalPaidByPayments >= newOriginal;
      if (isFullyPaid) {
        if (!current.interest_stop_date) {
          updateData.interest_stop_date = todayString();
        }
      } else if (current.interest_stop_date) {
        updateData.interest_stop_date = null;
      }

      const debtProbe: IDebt = { ...current, ...updateData };
      const probeState = calculateDebtState(debtProbe, payments, new Date());
      updateData.status = probeState.status;

      const updated = await DebtModel.update(id, userId, updateData);
      if (!updated) {
        res.status(404).json({ message: 'Deuda no encontrada', errorCode: 'DEBT_NOT_FOUND' });
        return;
      }
      res.status(200).json(serializeDebt(hydrateDebt(updated, payments)));
    } catch (error) {
      console.error('Error al actualizar deuda:', error);
      res.status(500).json({ message: 'Error al actualizar la deuda', errorCode: 'INTERNAL_ERROR' });
    }
  }

  static async remove(req: IAuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const id = parseInt(String(req.params.id), 10);
      if (isNaN(id)) {
        res.status(400).json({ message: 'ID inválido', errorCode: 'INVALID_ID' });
        return;
      }
      const debt = await DebtModel.findById(id, userId);
      if (!debt) {
        res.status(404).json({ message: 'Deuda no encontrada', errorCode: 'DEBT_NOT_FOUND' });
        return;
      }

      const payments = await DebtModel.listPaymentsByDebt(id, userId);
      const expenseIds = payments
        .map((p) => p.expense_id)
        .filter((x): x is number => typeof x === 'number' && x > 0);

      if (expenseIds.length > 0) {
        try {
          await ExpenseModel.deleteMany(expenseIds, userId);
        } catch (e) {
          console.warn('No se pudieron borrar algunos gastos asociados a la deuda:', e);
        }
      }

      await DebtModel.deleteAllPaymentsForDebt(id, userId);
      const deleted = await DebtModel.hardDelete(id, userId);
      if (!deleted) {
        res.status(404).json({ message: 'Deuda no encontrada', errorCode: 'DEBT_NOT_FOUND' });
        return;
      }

      res.status(200).json({
        message: 'Deuda, pagos y gastos asociados eliminados correctamente.',
        archived: false,
      });
    } catch (error) {
      console.error('Error al eliminar deuda:', error);
      res.status(500).json({ message: 'Error al eliminar la deuda', errorCode: 'INTERNAL_ERROR' });
    }
  }

  static async registerPayment(req: IAuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const id = parseInt(String(req.params.id), 10);
      if (isNaN(id)) {
        res.status(400).json({ message: 'ID inválido', errorCode: 'INVALID_ID' });
        return;
      }

      const debt = await DebtModel.findById(id, userId);
      if (!debt || debt.deleted_at) {
        res.status(404).json({ message: 'Deuda no encontrada', errorCode: 'DEBT_NOT_FOUND' });
        return;
      }

      const payments = await DebtModel.listPaymentsByDebt(id, userId);
      const body = req.body || {};
      const monto = toNum(body.monto);
      const fecha = normalizeFecha(body.fecha);

      if (typeof monto !== 'number' || isNaN(monto) || monto <= 0) {
        res.status(400).json({ message: 'El monto del pago debe ser un número mayor a 0', errorCode: 'INVALID_AMOUNT' });
        return;
      }
      if (!isDateStringValid(fecha)) {
        res.status(400).json({ message: 'La fecha del pago es inválida', errorCode: 'INVALID_DATE' });
        return;
      }
      if (parseDateLocal(fecha).getTime() > parseDateLocal(todayString()).getTime()) {
        res.status(400).json({ message: 'La fecha del pago no puede ser futura', errorCode: 'INVALID_DATE' });
        return;
      }
      if (parseDateLocal(fecha).getTime() < parseDateLocal(debt.start_date).getTime()) {
        res.status(400).json({ message: 'La fecha del pago no puede ser anterior a la fecha de inicio de la deuda', errorCode: 'INVALID_DATE' });
        return;
      }

      const stateAtPaymentDate = calculateDebtState(debt, payments, parseDateLocal(fecha));
      if (monto > stateAtPaymentDate.total_pending) {
        res.status(400).json({
          message: `El pago no puede superar el total pendiente a esa fecha (Q${round2(stateAtPaymentDate.total_pending).toFixed(2)})`,
          errorCode: 'PAYMENT_EXCEEDS_TOTAL',
        });
        return;
      }

      const stateToday = calculateDebtState(debt, payments, new Date());
      if (monto > stateToday.total_pending) {
        res.status(400).json({
          message: `El pago no puede superar el total pendiente actual (Q${round2(stateToday.total_pending).toFixed(2)})`,
          errorCode: 'PAYMENT_EXCEEDS_TOTAL',
        });
        return;
      }

      // Validación temporal del gasto que generará este pago.
      const check = await ExpenseModel.validateTimeSeriesBalance(userId, {
        type: 'create',
        fecha,
        monto,
      });
      if (!check.ok) {
        res.status(400).json({
          message: `Saldo insuficiente a esa fecha. El saldo quedaría en Q${check.balance.toFixed(2)} el ${check.at}.`,
          errorCode: 'INSUFFICIENT_BALANCE',
        });
        return;
      }

      const expenseData = {
        fecha,
        descripcion: `Pago de deuda - ${debt.name}`,
        categoria: 'Deudas' as const,
        monto,
        debt_id: debt.id,
      };

      let expense;
      try {
        expense = await ExpenseModel.create(userId, expenseData);
      } catch (error) {
        console.error('Error al crear gasto del pago:', error);
        res.status(500).json({ message: 'Error al registrar el pago', errorCode: 'INTERNAL_ERROR' });
        return;
      }

      let payment;
      try {
        payment = await DebtModel.createPayment({
          debt_id: debt.id,
          user_id: userId,
          amount: monto,
          fecha,
          expense_id: expense.id,
        });
      } catch (error) {
        await ExpenseModel.delete(expense.id, userId);
        console.error('Error al crear pago:', error);
        res.status(500).json({ message: 'Error al registrar el pago', errorCode: 'INTERNAL_ERROR' });
        return;
      }

      const paymentsPlus = [...payments, payment];

      const chainCheck = validatePaymentChain(debt, paymentsPlus);
      if (!chainCheck.valid) {
        try {
          await ExpenseModel.delete(expense.id, userId);
          await DebtModel.deletePayment(payment.id, userId);
        } catch (e) {
          console.warn('No se pudo revertir el pago inválido:', e);
        }
        res.status(400).json({ message: chainCheck.message, errorCode: 'PAYMENT_CHAIN_INVALID' });
        return;
      }

      const newState = calculateDebtState(debt, paymentsPlus, new Date());
      const updateData: any = { status: newState.status };
      if (newState.capital_pending === 0 && !debt.interest_stop_date) {
        const sortedPlus = [...paymentsPlus].sort((a, b) => {
          const byDate = String(a.fecha).localeCompare(String(b.fecha));
          return byDate !== 0 ? byDate : Number(a.id) - Number(b.id);
        });
        let capital = 0;
        let stopDate = fecha;
        for (const p of sortedPlus) {
          capital += Number(p.amount);
          if (capital >= Number(debt.original_amount)) {
            stopDate = String(p.fecha).split('T')[0];
            break;
          }
        }
        updateData.interest_stop_date = stopDate;
      }
      if (updateData.interest_stop_date || updateData.status !== debt.status) {
        await DebtModel.update(debt.id, userId, updateData);
      }

      const fresh = await DebtModel.findById(debt.id, userId);
      res.status(201).json({
        payment,
        deuda: serializeDebt(hydrateDebt(fresh ?? debt, paymentsPlus)),
      });
    } catch (error) {
      console.error('Error al registrar pago:', error);
      res.status(500).json({ message: 'Error al registrar el pago', errorCode: 'INTERNAL_ERROR' });
    }
  }

  static async updatePayment(req: IAuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const debtId = parseInt(String(req.params.id), 10);
      const paymentId = parseInt(String(req.params.paymentId), 10);

      if (isNaN(debtId) || isNaN(paymentId)) {
        res.status(400).json({ message: 'ID inválido', errorCode: 'INVALID_ID' });
        return;
      }

      const debt = await DebtModel.findById(debtId, userId);
      if (!debt || debt.deleted_at) {
        res.status(404).json({ message: 'Deuda no encontrada', errorCode: 'DEBT_NOT_FOUND' });
        return;
      }

      const payment = await DebtModel.findPaymentById(paymentId, userId);
      if (!payment || payment.debt_id !== debtId) {
        res.status(404).json({ message: 'Pago no encontrado', errorCode: 'PAYMENT_NOT_FOUND' });
        return;
      }

      const body = req.body || {};
      const nuevoMonto = body.monto !== undefined ? toNum(body.monto) : Number(payment.amount);
      const nuevaFecha =
        body.fecha !== undefined
          ? normalizeFecha(body.fecha)
          : String(payment.fecha).split('T')[0];

      if (typeof nuevoMonto !== 'number' || isNaN(nuevoMonto) || nuevoMonto <= 0) {
        res.status(400).json({ message: 'El monto del pago debe ser un número mayor a 0', errorCode: 'INVALID_AMOUNT' });
        return;
      }
      if (!isDateStringValid(nuevaFecha)) {
        res.status(400).json({ message: 'La fecha del pago es inválida', errorCode: 'INVALID_DATE' });
        return;
      }
      if (parseDateLocal(nuevaFecha).getTime() > parseDateLocal(todayString()).getTime()) {
        res.status(400).json({ message: 'La fecha del pago no puede ser futura', errorCode: 'INVALID_DATE' });
        return;
      }
      if (parseDateLocal(nuevaFecha).getTime() < parseDateLocal(debt.start_date).getTime()) {
        res.status(400).json({
          message: 'La fecha del pago no puede ser anterior a la fecha de inicio de la deuda',
          errorCode: 'INVALID_DATE',
        });
        return;
      }

      const allPayments = await DebtModel.listPaymentsByDebt(debtId, userId);
      const others = allPayments.filter((p) => p.id !== paymentId);

      const stateAtDate = calculateDebtState(debt, others, parseDateLocal(nuevaFecha));
      if (nuevoMonto > stateAtDate.total_pending) {
        res.status(400).json({
          message: `El monto no puede superar el total pendiente a esa fecha (Q${round2(stateAtDate.total_pending).toFixed(2)})`,
          errorCode: 'PAYMENT_EXCEEDS_TOTAL',
        });
        return;
      }

      // Validación temporal del gasto asociado al pago.
      if (payment.expense_id) {
        const check = await ExpenseModel.validateTimeSeriesBalance(userId, {
          type: 'update',
          id: payment.expense_id,
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
      }

      const updatedPayment = await DebtModel.updatePayment(paymentId, userId, {
        amount: nuevoMonto,
        fecha: nuevaFecha,
      });
      if (!updatedPayment) {
        res.status(404).json({ message: 'Pago no encontrado', errorCode: 'PAYMENT_NOT_FOUND' });
        return;
      }

      // Validar la cadena completa con este pago ya actualizado.
      const allAfter = await DebtModel.listPaymentsByDebt(debtId, userId);
      const chainCheck = validatePaymentChain(debt, allAfter);
      if (!chainCheck.valid) {
        await DebtModel.updatePayment(paymentId, userId, {
          amount: Number(payment.amount),
          fecha: String(payment.fecha).split('T')[0],
        });
        res.status(400).json({ message: chainCheck.message, errorCode: 'PAYMENT_CHAIN_INVALID' });
        return;
      }

      if (payment.expense_id) {
        try {
          await ExpenseModel.update(payment.expense_id, userId, {
            fecha: nuevaFecha,
            monto: nuevoMonto,
          });
        } catch (e) {
          console.warn(`No se pudo actualizar el gasto ${payment.expense_id}:`, e);
        }
      }

      const remaining = await DebtModel.listPaymentsByDebt(debtId, userId);
      const fresh = await DebtModel.findById(debtId, userId);
      if (fresh) {
        const newState = calculateDebtState(fresh, remaining, new Date());
        const updateData: any = { status: newState.status };
        if (newState.capital_pending > 0 && fresh.interest_stop_date) {
          updateData.interest_stop_date = null;
        }
        if (newState.capital_pending === 0 && !fresh.interest_stop_date) {
          const lastPayment = remaining[remaining.length - 1];
          updateData.interest_stop_date = lastPayment ? lastPayment.fecha : todayString();
        }
        await DebtModel.update(debtId, userId, updateData);
      }

      const finalDebt = await DebtModel.findById(debtId, userId);
      const finalPayments = await DebtModel.listPaymentsByDebt(debtId, userId);
      res.status(200).json({
        payment: updatedPayment,
        deuda: finalDebt ? serializeDebt(hydrateDebt(finalDebt, finalPayments)) : null,
      });
    } catch (error) {
      console.error('Error al actualizar pago:', error);
      res.status(500).json({ message: 'Error al actualizar el pago', errorCode: 'INTERNAL_ERROR' });
    }
  }

  static async deletePayment(req: IAuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const debtId = parseInt(String(req.params.id), 10);
      const paymentId = parseInt(String(req.params.paymentId), 10);

      if (isNaN(debtId) || isNaN(paymentId)) {
        res.status(400).json({ message: 'ID inválido', errorCode: 'INVALID_ID' });
        return;
      }

      const debt = await DebtModel.findById(debtId, userId);
      if (!debt) {
        res.status(404).json({ message: 'Deuda no encontrada', errorCode: 'DEBT_NOT_FOUND' });
        return;
      }

      const payment = await DebtModel.findPaymentById(paymentId, userId);
      if (!payment || payment.debt_id !== debtId) {
        res.status(404).json({ message: 'Pago no encontrado', errorCode: 'PAYMENT_NOT_FOUND' });
        return;
      }

      const expenseIdsToDelete: number[] = [];
      if (payment.expense_id) {
        expenseIdsToDelete.push(payment.expense_id);
      } else {
        const orphans = await ExpenseModel.findByDebtAndAmount(
          userId,
          debtId,
          Number(payment.amount),
          String(payment.fecha).split('T')[0]
        );
        for (const o of orphans) expenseIdsToDelete.push(o.id);
      }

      if (expenseIdsToDelete.length > 0) {
        try {
          await ExpenseModel.deleteMany(expenseIdsToDelete, userId);
        } catch (e) {
          console.warn('No se pudieron borrar los gastos asociados al pago:', e);
        }
      }

      await DebtModel.deletePayment(paymentId, userId);

      const remaining = await DebtModel.listPaymentsByDebt(debtId, userId);

      const chainCheck = validatePaymentChain(debt, remaining);
      if (!chainCheck.valid) {
        try {
          const recreated = await DebtModel.createPayment({
            debt_id: debtId,
            user_id: userId,
            amount: Number(payment.amount),
            fecha: String(payment.fecha).split('T')[0],
            expense_id: payment.expense_id,
          });
          console.warn('Pago restaurado porque rompía la cadena:', recreated.id);
        } catch (e) {
          console.error('No se pudo restaurar el pago:', e);
        }
        res.status(400).json({ message: chainCheck.message, errorCode: 'PAYMENT_CHAIN_INVALID' });
        return;
      }

      const fresh = await DebtModel.findById(debtId, userId);
      if (fresh) {
        const newState = calculateDebtState(fresh, remaining, new Date());
        const updateData: any = { status: newState.status };
        if (newState.capital_pending > 0 && fresh.interest_stop_date) {
          updateData.interest_stop_date = null;
        }
        if (newState.capital_pending === 0 && !fresh.interest_stop_date) {
          const lastPayment = remaining[remaining.length - 1];
          updateData.interest_stop_date = lastPayment ? lastPayment.fecha : todayString();
        }
        await DebtModel.update(debtId, userId, updateData);
      }

      const finalDebt = await DebtModel.findById(debtId, userId);
      const finalPayments = await DebtModel.listPaymentsByDebt(debtId, userId);
      res.status(200).json({
        message: 'Pago y gasto asociado eliminados correctamente.',
        deuda: finalDebt ? serializeDebt(hydrateDebt(finalDebt, finalPayments)) : null,
      });
    } catch (error) {
      console.error('Error al eliminar pago:', error);
      res.status(500).json({ message: 'Error al eliminar el pago', errorCode: 'INTERNAL_ERROR' });
    }
  }

  static async cleanupOrphanExpenses(req: IAuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const deleted = await ExpenseModel.deleteOrphanDebtExpenses(userId);
      res.status(200).json({
        message: `Se eliminaron ${deleted} gasto(s) huérfano(s) de la categoría Deudas.`,
        deleted,
      });
    } catch (error) {
      console.error('Error al limpiar gastos huérfanos:', error);
      res.status(500).json({ message: 'Error al limpiar gastos huérfanos', errorCode: 'INTERNAL_ERROR' });
    }
  }

  static async getProgress(req: IAuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const debts = await DebtModel.findAllForProgress(userId);
      const paymentsByDebt = await buildPaymentsByDebt(userId);

      let total = 0;
      let pagado = 0;
      const deudas: { id: number; nombre: string; total: number; pagado: number }[] = [];

      for (const debt of debts) {
        const state = calculateDebtState(debt, paymentsByDebt.get(debt.id) || [], new Date());
        const debtTotal = state.total_current;
        const debtPagado = state.total_paid;
        total = round2(total + debtTotal);
        pagado = round2(pagado + debtPagado);
        deudas.push({ id: debt.id, nombre: debt.name, total: debtTotal, pagado: debtPagado });
      }

      deudas.sort((a, b) => b.total - a.total);
      const restante = round2(Math.max(0, total - pagado));
      const porcentaje = total > 0 ? Math.round((pagado / total) * 1000) / 10 : 0;

      res.status(200).json({ total, pagado, restante, porcentaje, deudas });
    } catch (error) {
      console.error('Error al obtener progreso de deudas:', error);
      res.status(500).json({ message: 'Error al obtener el progreso de las deudas', errorCode: 'INTERNAL_ERROR' });
    }
  }
}