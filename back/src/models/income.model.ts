import database from '../config/database';

export interface IIncome {
  id: number;
  user_id: number;
  fecha: string;
  descripcion: string;
  categoria: 'Salario' | 'Trabajo extra' | 'Bono' | 'Venta' | 'Otro';
  monto: number;
  created_at: Date;
  updated_at: Date;
}

export interface IIncomeCreate {
  fecha: string;
  descripcion: string;
  categoria: 'Salario' | 'Trabajo extra' | 'Bono' | 'Venta' | 'Otro';
  monto: number;
}

export const INCOME_CATEGORIES = ['Salario', 'Trabajo extra', 'Bono', 'Venta', 'Otro'] as const;
export type IncomeCategory = typeof INCOME_CATEGORIES[number];

export class IncomeModel {
  static async create(userId: number, data: IIncomeCreate): Promise<IIncome> {
    const result = await database.query<IIncome>(
      `INSERT INTO incomes (user_id, fecha, descripcion, categoria, monto)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, data.fecha, data.descripcion, data.categoria, data.monto]
    );
    return result.rows[0];
  }

  static async findById(id: number, userId: number): Promise<IIncome | null> {
    const result = await database.query<IIncome>(
      'SELECT * FROM incomes WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    return result.rows[0] || null;
  }

  static async findAll(userId: number, filters?: {
    fechaDesde?: string;
    fechaHasta?: string;
    categoria?: string;
  }): Promise<IIncome[]> {
    let query = 'SELECT * FROM incomes WHERE user_id = $1';
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

    const result = await database.query<IIncome>(query, params);
    return result.rows;
  }

  static async update(
    id: number,
    userId: number,
    data: Partial<IIncomeCreate>
  ): Promise<IIncome | null> {
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
      return await IncomeModel.findById(id, userId);
    }

    values.push(id, userId);
    const query = `
      UPDATE incomes
      SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${paramIndex} AND user_id = $${paramIndex + 1}
      RETURNING *
    `;

    const result = await database.query<IIncome>(query, values);
    return result.rows[0] || null;
  }

  static async delete(id: number, userId: number): Promise<boolean> {
    const result = await database.query(
      'DELETE FROM incomes WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    );
    return result.rowCount !== null && result.rowCount > 0;
  }

  static async getSummary(userId: number, fechaDesde: string, fechaHasta: string): Promise<{
    total: number;
    count: number;
    average: number;
  }> {
    const result = await database.query<{
      total: string;
      count: string;
      average: string;
    }>(
      `SELECT
        COALESCE(SUM(monto), 0) as total,
        COUNT(*) as count,
        COALESCE(AVG(monto), 0) as average
       FROM incomes
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
    | { type: 'delete'; id: number }
    | { type: 'update'; id: number; monto: number }
    | null
): Promise<{ ok: true } | { ok: false; at: string; balance: number }> {
  // Traemos todos los movimientos del usuario: ingresos y gastos con fecha y monto.
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

  // Aplicamos el cambio pendiente sobre la lista, si corresponde.
  type Row = { tipo: 'ingreso' | 'gasto'; id: number; fecha: string; monto: number };
  const rows: Row[] = [];

  for (const r of result.rows) {
    let monto = parseFloat(r.monto);

    if (pendingChange && r.tipo === 'ingreso' && r.id === pendingChange.id) {
      if (pendingChange.type === 'delete') {
        continue; // se elimina
      }
      if (pendingChange.type === 'update') {
        monto = pendingChange.monto;
      }
    }

    rows.push({ tipo: r.tipo, id: r.id, fecha: r.fecha, monto });
  }

  // Reordenamos porque al aplicar cambios puede haberse alterado el orden.
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