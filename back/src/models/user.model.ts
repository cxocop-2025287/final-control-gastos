import database from '../config/database';
import { Role } from '../types/auth.types';

export interface IUser {
  id: number;
  name: string;
  password: string;
  role: Role;
  is_active: boolean;
  google_id?: string;
  created_at: Date;
  updated_at: Date;
}

export interface IUserSafe {
  id: number;
  name: string;
  role: Role;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export class UserModel {
  static async findByName(name: string): Promise<IUser | null> {
    const result = await database.query<IUser>(
      'SELECT * FROM users WHERE name = $1',
      [name]
    );
    return result.rows[0] || null;
  }

  static async findById(id: number): Promise<IUser | null> {
    const result = await database.query<IUser>(
      'SELECT * FROM users WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  static async findByGoogleId(googleId: string): Promise<IUser | null> {
    const result = await database.query<IUser>(
      'SELECT * FROM users WHERE google_id = $1',
      [googleId]
    );
    return result.rows[0] || null;
  }

  static async create(data: {
    name: string;
    password: string;
    role: Role;
    is_active?: boolean;
    google_id?: string;
  }): Promise<IUser> {
    const result = await database.query<IUser>(
      'INSERT INTO users (name, password, role, is_active, google_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [data.name, data.password, data.role, data.is_active ?? true, data.google_id || null]
    );
    return result.rows[0];
  }

  static async findAll(): Promise<IUserSafe[]> {
    const result = await database.query<IUserSafe>(
      'SELECT id, name, role, is_active, created_at, updated_at FROM users ORDER BY id'
    );
    return result.rows;
  }

  static toSafe(user: IUser): IUserSafe {
    const { password, ...safe } = user;
    return safe;
  }
}