import { Request, Response } from 'express';
import { IncomeModel, IIncomeCreate, INCOME_CATEGORIES } from '../models/income.model';
import { IAuthRequest } from '../types/auth.types';

type IncomeCategory = typeof INCOME_CATEGORIES[number];

export class IncomeController {
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
        if (INCOME_CATEGORIES.includes(categoriaStr as IncomeCategory)) {
          filters.categoria = categoriaStr;
        }
      }

      const incomes = await IncomeModel.findAll(userId, filters);
      res.status(200).json(incomes);
    } catch (error) {
      console.error('Error al obtener ingresos:', error);
      res.status(500).json({
        message: 'Error al obtener los ingresos',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  static async getSummary(req: IAuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const { fechaDesde, fechaHasta } = req.query;

      if (!fechaDesde || !fechaHasta) {
        res.status(400).json({
          message: 'Se requieren fechaDesde y fechaHasta',
          errorCode: 'MISSING_PARAMS',
        });
        return;
      }

      const summary = await IncomeModel.getSummary(
        userId,
        String(fechaDesde).split('T')[0],
        String(fechaHasta).split('T')[0]
      );

      res.status(200).json(summary);
    } catch (error) {
      console.error('Error al obtener resumen:', error);
      res.status(500).json({
        message: 'Error al obtener el resumen',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  static async create(req: IAuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const { fecha, descripcion, categoria, monto } = req.body;

      if (!fecha || !descripcion || !categoria || monto === undefined) {
        res.status(400).json({
          message: 'Todos los campos son obligatorios',
          errorCode: 'MISSING_FIELDS',
        });
        return;
      }

      if (typeof categoria !== 'string' || !INCOME_CATEGORIES.includes(categoria as IncomeCategory)) {
        res.status(400).json({
          message: `Categoría inválida. Debe ser: ${INCOME_CATEGORIES.join(', ')}`,
          errorCode: 'INVALID_CATEGORY',
        });
        return;
      }

      const montoNum = typeof monto === 'string' ? parseFloat(monto) : monto;
      if (typeof montoNum !== 'number' || isNaN(montoNum) || montoNum <= 0) {
        res.status(400).json({
          message: 'El monto debe ser un número mayor a 0',
          errorCode: 'INVALID_AMOUNT',
        });
        return;
      }

      const incomeData: IIncomeCreate = {
        fecha: String(fecha).split('T')[0],
        descripcion: descripcion.trim(),
        categoria: categoria as IncomeCategory,
        monto: montoNum,
      };

      const created = await IncomeModel.create(userId, incomeData);
      res.status(201).json(created);
    } catch (error) {
      console.error('Error al crear ingreso:', error);
      res.status(500).json({
        message: 'Error al crear el ingreso',
        errorCode: 'INTERNAL_ERROR',
      });
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

      const current = await IncomeModel.findById(id, userId);
      if (!current) {
        res.status(404).json({ message: 'Ingreso no encontrado', errorCode: 'INCOME_NOT_FOUND' });
        return;
      }

      const { fecha, descripcion, categoria, monto } = req.body;
      const updateData: any = {};

      if (fecha !== undefined) updateData.fecha = String(fecha).split('T')[0];
      if (descripcion !== undefined) updateData.descripcion = descripcion.trim();

      if (categoria !== undefined) {
        if (typeof categoria !== 'string' || !INCOME_CATEGORIES.includes(categoria as IncomeCategory)) {
          res.status(400).json({
            message: `Categoría inválida. Debe ser: ${INCOME_CATEGORIES.join(', ')}`,
            errorCode: 'INVALID_CATEGORY',
          });
          return;
        }
        updateData.categoria = categoria;
      }

      if (monto !== undefined) {
        const montoNum = typeof monto === 'string' ? parseFloat(monto) : monto;
        if (typeof montoNum !== 'number' || isNaN(montoNum) || montoNum <= 0) {
          res.status(400).json({
            message: 'El monto debe ser un número mayor a 0',
            errorCode: 'INVALID_AMOUNT',
          });
          return;
        }

        // Validación temporal: al aplicar el nuevo monto, el saldo acumulado
        // en ningún punto de la historia debe quedar negativo.
        const check = await IncomeModel.validateTimeSeriesBalance(userId, {
          type: 'update',
          id,
          monto: montoNum,
        });
        if (!check.ok) {
          res.status(400).json({
            message: `Este cambio dejaría el saldo en Q${check.balance.toFixed(2)} el ${check.at}. Ajuste los gastos u otros ingresos primero.`,
            errorCode: 'INCOME_WOULD_CAUSE_NEGATIVE_BALANCE',
          });
          return;
        }

        updateData.monto = montoNum;
      }

      const updated = await IncomeModel.update(id, userId, updateData);
      if (!updated) {
        res.status(404).json({ message: 'Ingreso no encontrado', errorCode: 'INCOME_NOT_FOUND' });
        return;
      }

      res.status(200).json(updated);
    } catch (error) {
      console.error('Error al actualizar ingreso:', error);
      res.status(500).json({
        message: 'Error al actualizar el ingreso',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  static async delete(req: IAuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const id = parseInt(String(req.params.id), 10);
      if (isNaN(id)) {
        res.status(400).json({ message: 'ID inválido', errorCode: 'INVALID_ID' });
        return;
      }

      const current = await IncomeModel.findById(id, userId);
      if (!current) {
        res.status(404).json({ message: 'Ingreso no encontrado', errorCode: 'INCOME_NOT_FOUND' });
        return;
      }

      // Validación temporal: al eliminar este ingreso, el saldo acumulado en
      // ningún punto de la historia debe quedar negativo.
      const check = await IncomeModel.validateTimeSeriesBalance(userId, {
        type: 'delete',
        id,
      });
      if (!check.ok) {
        res.status(400).json({
          message: `No puede eliminar este ingreso porque el saldo quedaría en Q${check.balance.toFixed(2)} el ${check.at}. Elimine o reduzca gastos posteriores a esa fecha.`,
          errorCode: 'INCOME_WOULD_CAUSE_NEGATIVE_BALANCE',
        });
        return;
      }

      const deleted = await IncomeModel.delete(id, userId);
      if (!deleted) {
        res.status(404).json({ message: 'Ingreso no encontrado', errorCode: 'INCOME_NOT_FOUND' });
        return;
      }

      res.status(200).json({ message: 'Ingreso eliminado correctamente' });
    } catch (error) {
      console.error('Error al eliminar ingreso:', error);
      res.status(500).json({
        message: 'Error al eliminar el ingreso',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  static async getCategories(req: Request, res: Response): Promise<void> {
    res.status(200).json(INCOME_CATEGORIES);
  }
}