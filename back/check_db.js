const { Pool } = require('pg');
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'admin',
  database: 'control_de_gastos'
});

(async () => {
  try {
    await pool.query(`
      ALTER TABLE expenses DROP COLUMN IF EXISTS debt_id;
      DROP TABLE IF EXISTS debt_payments CASCADE;
      DROP TABLE IF EXISTS debts CASCADE;
    `);
    console.log('✔ Tablas de deudas y columna expenses.debt_id eliminadas.');
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
})();