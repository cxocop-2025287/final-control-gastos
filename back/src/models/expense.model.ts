import database from '../config/database';

export interface IExpense {
  id: number;
  user_id: number;
  fecha: string;
  descripcion: string;
  categoria: 'Comida' | 'Transporte' | 'Vivienda' | 'Salud' | 'Educación' | 'Ocio' | 'Otro' | 'Deudas';
  monto: number;
  debt_id: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface IExpenseCreate {
  fecha: string;
  descripcion: string;
  categoria: 'Comida' | 'Transporte' | 'Vivienda' | 'Salud' | 'Educación' | 'Ocio' | 'Otro' | 'Deudas';
  monto: number;
  debt_id?: number | null;
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

export class ExpenseModel {
  static async create(userId: number, data: IExpenseCreate): Promise<IExpense> {
    const result = await database.query<IExpense>(
      `INSERT INTO expenses (user_id, fecha, descripcion, categoria, monto, debt_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, data.fecha, data.descripcion, data.categoria, data.monto, data.debt_id ?? null]
    );
    return result.rows[0];
  }

  static async findById(id: number, userId: number): Promise<IExpense | null> {
    const result = await database.query<IExpense>(
      'SELECT * FROM expenses WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    return result.rows[0] || null;
  }

  static async findAll(
    userId: number,
    filters?: { fechaDesde?: string; fechaHasta?: string; categoria?: string }
  ): Promise<IExpense[]> {
    let query = 'SELECT * FROM expenses WHERE user_id = $1';
    const params: any[] = [userId];
    let paramIndex = 2;

    if (filters?.fechaDesde) {
      query += ` AND fecha >= $${paramIndex}`;
      params.push(filters.fechaDesde);
      paramIndex++;
    }
    if (filters?.fechaHasta) {
      query += ` AND fecha <= $${paramIndex}`;
      params.push(filters.fechaHasta);
      paramIndex++;
    }
    if (filters?.categoria) {
      query += ` AND categoria = $${paramIndex}`;
      params.push(filters.categoria);
      paramIndex++;
    }

    query += ' ORDER BY fecha DESC, id DESC';
    const result = await database.query<IExpense>(query, params);
    return result.rows;
  }

  static async update(
    id: number,
    userId: number,
    data: Partial<IExpenseCreate>
  ): Promise<IExpense | null> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (data.fecha !== undefined) {
      fields.push(`fecha = $${paramIndex}`);
      values.push(data.fecha);
      paramIndex++;
    }
    if (data.descripcion !== undefined) {
      fields.push(`descripcion = $${paramIndex}`);
      values.push(data.descripcion);
      paramIndex++;
    }
    if (data.categoria !== undefined) {
      fields.push(`categoria = $${paramIndex}`);
      values.push(data.categoria);
      paramIndex++;
    }
    if (data.monto !== undefined) {
      fields.push(`monto = $${paramIndex}`);
      values.push(data.monto);
      paramIndex++;
    }

    if (fields.length === 0) {
      return await ExpenseModel.findById(id, userId);
    }

    values.push(id, userId);
    const query = `
      UPDATE expenses
      SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${paramIndex} AND user_id = $${paramIndex + 1}
      RETURNING *
    `;

    const result = await database.query<IExpense>(query, values);
    return result.rows[0] || null;
  }

  static async delete(id: number, userId: number): Promise<boolean> {
    const result = await database.query(
      'DELETE FROM expenses WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    );
    return result.rowCount !== null && result.rowCount > 0;
  }

  static async deleteMany(ids: number[], userId: number): Promise<number> {
    if (!ids.length) return 0;
    const result = await database.query(
      'DELETE FROM expenses WHERE id = ANY($1::int[]) AND user_id = $2',
      [ids, userId]
    );
    return result.rowCount ?? 0;
  }

  static async findByDebtAndAmount(
    userId: number,
    debtId: number,
    monto: number,
    fecha: string
  ): Promise<IExpense[]> {
    const result = await database.query<IExpense>(
      `SELECT * FROM expenses
       WHERE user_id = $1
         AND debt_id = $2
         AND monto = $3
         AND fecha = $4`,
      [userId, debtId, monto, fecha]
    );
    return result.rows;
  }

  static async deleteOrphanDebtExpenses(userId: number): Promise<number> {
    const result = await database.query(
      `DELETE FROM expenses e
       WHERE e.user_id = $1
         AND e.categoria = 'Deudas'
         AND NOT EXISTS (
           SELECT 1 FROM debt_payments dp WHERE dp.expense_id = e.id
         )`,
      [userId]
    );
    return result.rowCount ?? 0;
  }

  static async getSummary(
    userId: number,
    fechaDesde: string,
    fechaHasta: string
  ): Promise<{ total: number; count: number; average: number }> {
    const result = await database.query<{
      total: string;
      count: string;
      average: string;
    }>(
      `SELECT
        COALESCE(SUM(monto), 0) as total,
        COUNT(*) as count,
        COALESCE(AVG(monto), 0) as average
       FROM expenses
       WHERE user_id = $1 AND fecha BETWEEN $2 AND $3`,
      [userId, fechaDesde, fechaHasta]
    );

    const row = result.rows[0];
    return {
      total: parseFloat(row.total),
      count: parseInt(row.count, 10),
      average: parseFloat(row.average),
    };
  }

  static async getBalance(userId: number): Promise<number> {
    const result = await database.query<{ balance: string }>(
      `SELECT
         (SELECT COALESCE(SUM(monto), 0) FROM incomes WHERE user_id = $1)
         - (SELECT COALESCE(SUM(monto), 0) FROM expenses WHERE user_id = $1)
       AS balance`,
      [userId]
    );
    return parseFloat(result.rows[0].balance);
  }
  static async validateTimeSeriesBalance(
  userId: number,
  pendingChange:
    | { type: 'create'; fecha: string; monto: number }
    | { type: 'update'; id: number; monto: number; fecha?: string }
    | { type: 'delete'; id: number }
    | null
): Promise<{ ok: true } | { ok: false; at: string; balance: number }> {
  const result = await database.query<{
    tipo: 'ingreso' | 'gasto';
    id: number;
    fecha: string;
    monto: string;
  }>(
    `SELECT 'ingreso' AS tipo, id, fecha, monto FROM incomes WHERE user_id = $1
     UNION ALL
     SELECT 'gasto' AS tipo, id, fecha, monto FROM expenses WHERE user_id = $1
     ORDER BY fecha ASC, id ASC`,
    [userId]
  );

  type Row = { tipo: 'ingreso' | 'gasto'; id: number; fecha: string; monto: number };
  const rows: Row[] = [];

  // Aplicar el cambio pendiente sobre la lista, si corresponde.
  let pendingInserted = false;

  for (const r of result.rows) {
    let monto = parseFloat(r.monto);
    let fecha = String(r.fecha).split('T')[0];

    if (pendingChange && r.tipo === 'gasto') {
      if (pendingChange.type === 'delete' && r.id === pendingChange.id) {
        continue;
      }
      if (pendingChange.type === 'update' && r.id === pendingChange.id) {
        monto = pendingChange.monto;
        if (pendingChange.fecha) fecha = pendingChange.fecha;
      }
    }

    rows.push({ tipo: r.tipo, id: r.id, fecha, monto });
  }

  // Insertar el gasto nuevo (create) en su posición por fecha.
  if (pendingChange && pendingChange.type === 'create' && !pendingInserted) {
    rows.push({
      tipo: 'gasto',
      id: Number.MAX_SAFE_INTEGER, // se ordena al final entre los de su fecha
      fecha: String(pendingChange.fecha).split('T')[0],
      monto: pendingChange.monto,
    });
  }

  rows.sort((a, b) => {
    const byFecha = String(a.fecha).localeCompare(String(b.fecha));
    return byFecha !== 0 ? byFecha : a.id - b.id;
  });

  // Recorremos acumulando. El saldo debe ser >= 0 en todo momento.
  let saldo = 0;
  for (const r of rows) {
    if (r.tipo === 'ingreso') saldo += r.monto;
    else saldo -= r.monto;

    if (saldo < -0.005) {
      return { ok: false, at: String(r.fecha).split('T')[0], balance: saldo };
    }
  }

  return { ok: true };
}
}