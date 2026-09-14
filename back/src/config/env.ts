import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const env = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_PORT: parseInt(process.env.DB_PORT || '5432', 10),
  DB_USER: process.env.DB_USER || 'postgres',
  DB_PASSWORD: process.env.DB_PASSWORD || 'admin',
  DB_NAME: process.env.DB_NAME || 'control_de_gastos',
  JWT_SECRET: process.env.JWT_SECRET || 'default_secret_change_me',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '24h',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:4200',
  SEED_USER_PASSWORD: process.env.SEED_USER_PASSWORD || 'usuario123',
  SEED_ADMIN_PASSWORD: process.env.SEED_ADMIN_PASSWORD || 'admin123',
  SESSION_INACTIVITY_TIMEOUT: parseInt(process.env.SESSION_INACTIVITY_TIMEOUT || '14400', 10),
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '155138157347-q7jcnhj60ohs5caa2di46dvsrmdpljfd.apps.googleusercontent.com',
};