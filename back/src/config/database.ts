import { Pool, PoolConfig, QueryResultRow, types } from 'pg';
import { env } from './env';

// Forzar que el tipo DATE (OID 1082) de PostgreSQL se retorne como string 'YYYY-MM-DD'
// sin conversión de zona horaria por parte de JavaScript Date
types.setTypeParser(1082, (val: string) => val);

class DatabaseService {
  private static instance: DatabaseService;
  private pool: Pool | null = null;
  private isInitialized = false;

  private constructor() {}

  public static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    const config: PoolConfig = {
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: env.DB_NAME,
      max: 20,
      idleTimeoutMillis: 1000,
      connectionTimeoutMillis: 5000,
    };

    this.pool = new Pool(config);

    try {
      await this.pool.query('SELECT NOW()');
      this.isInitialized = true;
      console.log('PostgreSQL conectado');
      await this.createTables();
    } catch (error) {
      console.error('Error al conectar con PostgreSQL:', error);
      throw error;
    }
  }

  private async createTables(): Promise<void> {
    const createUsersTable = `
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(10) NOT NULL DEFAULT 'USER' CHECK (role IN ('USER', 'ADMIN')),
        is_active BOOLEAN NOT NULL DEFAULT true,
        google_id VARCHAR(255) UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    const createIncomesTable = `
      CREATE TABLE IF NOT EXISTS incomes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        fecha DATE NOT NULL DEFAULT CURRENT_DATE,
        descripcion VARCHAR(255) NOT NULL,
        categoria VARCHAR(50) NOT NULL CHECK (categoria IN ('Salario', 'Trabajo extra', 'Bono', 'Venta', 'Otro')),
        monto DECIMAL(12,2) NOT NULL CHECK (monto > 0),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    const createIndexes = `
      CREATE INDEX IF NOT EXISTS idx_users_name ON users(name);
      CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
      CREATE INDEX IF NOT EXISTS idx_incomes_user_id ON incomes(user_id);
      CREATE INDEX IF NOT EXISTS idx_incomes_fecha ON incomes(fecha);
      CREATE INDEX IF NOT EXISTS idx_incomes_categoria ON incomes(categoria);
    `;

    const updateTrigger = `
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ language 'plpgsql';

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger WHERE tgname = 'update_users_updated_at'
        ) THEN
          CREATE TRIGGER update_users_updated_at
            BEFORE UPDATE ON users
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
        END IF;
      END;
      $$;

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger WHERE tgname = 'update_incomes_updated_at'
        ) THEN
          CREATE TRIGGER update_incomes_updated_at
            BEFORE UPDATE ON incomes
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
        END IF;
      END;
      $$;
    `;

    try {
      await this.pool!.query(createUsersTable);
      await this.pool!.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE;');
      await this.pool!.query(createIncomesTable);
      await this.pool!.query(createIndexes);
      await this.pool!.query(updateTrigger);
      console.log('Tablas verificadas/creadas correctamente');
    } catch (error) {
      console.error('Error al crear tablas:', error);
      throw error;
    }
  }

  public async query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<{ rows: T[]; rowCount: number | null }> {
    if (!this.isInitialized || !this.pool) {
      throw new Error('DatabaseService no inicializado');
    }

    try {
      return await this.pool.query<T>(text, params);
    } catch (error) {
      console.error('Error en query:', error);
      throw error;
    }
  }

  public async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.isInitialized = false;
      this.pool = null;
    }
  }

  public isConnected(): boolean {
    return this.isInitialized && this.pool !== null;
  }
}

export default DatabaseService.getInstance();