import database from '../config/database';

export const INTEREST_PERIODS = ['daily', 'biweekly', 'monthly'] as const;
export type InterestPeriod = typeof INTEREST_PERIODS[number];

export const DEBT_STATUSES = ['activa', 'capital_pagado', 'pagada'] as const;
export type DebtStatus = typeof DEBT_STATUSES[number];

export interface IDebt {
  id: number;
  user_id: number;
  name: string;
  creditor: string;
  original_amount: number;
  interest_enabled: boolean;
  interest_rate: number;
  interest_period: InterestPeriod;
  start_date: string;
  interest_stop_date: string | null;
  status: DebtStatus;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface IDebtCreate {
  name: string;
  creditor: string;
  original_amount: number;
  interest_enabled: boolean;
  interest_rate: number;
  interest_period: InterestPeriod;
  start_date: string;
  interest_stop_date?: string | null;
  status: DebtStatus;
}

export interface IDebtUpdate {
  name?: string;
  creditor?: string;
  original_amount?: number;
  interest_enabled?: boolean;
  interest_rate?: number;
  interest_period?: InterestPeriod;
  start_date?: string;
  interest_stop_date?: string | null;
  status?: DebtStatus;
}

export interface IDebtPayment {
  id: number;
  debt_id: number;
  user_id: number;
  amount: number;
  fecha: string;
  expense_id: number | null;
  created_at: Date;
}

export class DebtModel {
  static async create(userId: number, data: IDebtCreate): Promise<IDebt> {
    const result = await database.query<IDebt>(
      `INSERT INTO debts (
        user_id, name, creditor, original_amount,
        interest_enabled, interest_rate, interest_period, start_date,
        interest_stop_date, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        userId,
        data.name,
        data.creditor,
        data.original_amount,
        data.interest_enabled,
        data.interest_enabled ? data.interest_rate : 0,
        data.interest_period,
        data.start_date,
        data.interest_stop_date ?? null,
        data.status,
      ]
    );
    return result.rows[0];
  }

  static async findById(id: number, userId: number): Promise<IDebt | null> {
    const result = await database.query<IDebt>(
      'SELECT * FROM debts WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    return result.rows[0] || null;
  }

  static async findAll(
    userId: number,
    opts: { onlyArchived?: boolean } = {}
  ): Promise<IDebt[]> {
    const onlyArchived = opts.onlyArchived === true;
    const filter = onlyArchived ? 'AND deleted_at IS NOT NULL' : 'AND deleted_at IS NULL';
    const result = await database.query<IDebt>(
      `SELECT * FROM debts
       WHERE user_id = $1 ${filter}
       ORDER BY (status = 'pagada') ASC, id DESC`,
      [userId]
    );
    return result.rows;
  }

  static async findAllForProgress(userId: number): Promise<IDebt[]> {
    const result = await database.query<IDebt>(
      'SELECT * FROM debts WHERE user_id = $1 ORDER BY id DESC',
      [userId]
    );
    return result.rows;
  }

  static async update(
    id: number,
    userId: number,
    data: IDebtUpdate
  ): Promise<IDebt | null> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
      fields.push(`name = $${paramIndex}`);
      values.push(data.name);
      paramIndex++;
    }
    if (data.creditor !== undefined) {
      fields.push(`creditor = $${paramIndex}`);
      values.push(data.creditor);
      paramIndex++;
    }
    if (data.original_amount !== undefined) {
      fields.push(`original_amount = $${paramIndex}`);
      values.push(data.original_amount);
      paramIndex++;
    }
    if (data.interest_enabled !== undefined) {
      fields.push(`interest_enabled = $${paramIndex}`);
      values.push(data.interest_enabled);
      paramIndex++;
    }
    if (data.interest_rate !== undefined) {
      fields.push(`interest_rate = $${paramIndex}`);
      values.push(data.interest_rate);
      paramIndex++;
    }
    if (data.interest_period !== undefined) {
      fields.push(`interest_period = $${paramIndex}`);
      values.push(data.interest_period);
      paramIndex++;
    }
    if (data.start_date !== undefined) {
      fields.push(`start_date = $${paramIndex}`);
      values.push(data.start_date);
      paramIndex++;
    }
    if (data.interest_stop_date !== undefined) {
      fields.push(`interest_stop_date = $${paramIndex}`);
      values.push(data.interest_stop_date === null ? null : data.interest_stop_date);
      paramIndex++;
    }
    if (data.status !== undefined) {
      fields.push(`status = $${paramIndex}`);
      values.push(data.status);
      paramIndex++;
    }

    if (fields.length === 0) {
      return await DebtModel.findById(id, userId);
    }

    values.push(id, userId);
    const query = `
      UPDATE debts
      SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${paramIndex} AND user_id = $${paramIndex + 1}
      RETURNING *
    `;

    const result = await database.query<IDebt>(query, values);
    return result.rows[0] || null;
  }

  static async archive(id: number, userId: number): Promise<boolean> {
    const result = await database.query(
      `UPDATE debts SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [id, userId]
    );
    return result.rowCount !== null && result.rowCount > 0;
  }

  static async restore(id: number, userId: number): Promise<boolean> {
    const result = await database.query(
      `UPDATE debts SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NOT NULL
       RETURNING id`,
      [id, userId]
    );
    return result.rowCount !== null && result.rowCount > 0;
  }

  static async hardDelete(id: number, userId: number): Promise<boolean> {
    const result = await database.query(
      'DELETE FROM debts WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    );
    return result.rowCount !== null && result.rowCount > 0;
  }

  static async countPayments(debtId: number): Promise<number> {
    const result = await database.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM debt_payments WHERE debt_id = $1',
      [debtId]
    );
    return parseInt(result.rows[0].count, 10);
  }

  static async listPaymentsByDebt(debtId: number, userId: number): Promise<IDebtPayment[]> {
    const result = await database.query<IDebtPayment>(
      `SELECT * FROM debt_payments
       WHERE debt_id = $1 AND user_id = $2
       ORDER BY fecha ASC, id ASC`,
      [debtId, userId]
    );
    return result.rows;
  }

  static async listAllPaymentsForUser(userId: number): Promise<IDebtPayment[]> {
    const result = await database.query<IDebtPayment>(
      'SELECT * FROM debt_payments WHERE user_id = $1 ORDER BY fecha ASC, id ASC',
      [userId]
    );
    return result.rows;
  }

  static async findPaymentById(paymentId: number, userId: number): Promise<IDebtPayment | null> {
    const result = await database.query<IDebtPayment>(
      'SELECT * FROM debt_payments WHERE id = $1 AND user_id = $2',
      [paymentId, userId]
    );
    return result.rows[0] || null;
  }

  static async createPayment(data: {
    debt_id: number;
    user_id: number;
    amount: number;
    fecha: string;
    expense_id: number | null;
  }): Promise<IDebtPayment> {
    const result = await database.query<IDebtPayment>(
      `INSERT INTO debt_payments (debt_id, user_id, amount, fecha, expense_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [data.debt_id, data.user_id, data.amount, data.fecha, data.expense_id]
    );
    return result.rows[0];
  }

  static async updatePayment(
    paymentId: number,
    userId: number,
    data: { amount: number; fecha: string }
  ): Promise<IDebtPayment | null> {
    const result = await database.query<IDebtPayment>(
      `UPDATE debt_payments
       SET amount = $1, fecha = $2
       WHERE id = $3 AND user_id = $4
       RETURNING *`,
      [data.amount, data.fecha, paymentId, userId]
    );
    return result.rows[0] || null;
  }

  static async deletePayment(paymentId: number, userId: number): Promise<boolean> {
    const result = await database.query(
      'DELETE FROM debt_payments WHERE id = $1 AND user_id = $2 RETURNING id',
      [paymentId, userId]
    );
    return result.rowCount !== null && result.rowCount > 0;
  }

  static async deleteAllPaymentsForDebt(debtId: number, userId: number): Promise<number> {
    const result = await database.query(
      'DELETE FROM debt_payments WHERE debt_id = $1 AND user_id = $2',
      [debtId, userId]
    );
    return result.rowCount ?? 0;
  }
}