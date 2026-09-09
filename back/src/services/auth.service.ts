import bcrypt from 'bcryptjs';
import { UserModel, IUser } from '../models/user.model';
import { generateToken } from '../utils/jwt';
import { ILoginRequest, ILoginResponse, Role } from '../types/auth.types';
import { env } from '../config/env';
import { registerActivity } from '../middleware/activity.middleware';
import database from '../config/database';

export class AppError extends Error {
  public statusCode: number;
  public errorCode: string;

  constructor(message: string, statusCode: number, errorCode: string) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.name = 'AppError';
  }
}

export class AuthService {
  static async login(data: ILoginRequest): Promise<ILoginResponse> {
    const user: IUser | null = await UserModel.findByName(data.name);

    if (!user) {
      throw new AppError('Credenciales incorrectas', 401, 'INVALID_CREDENTIALS');
    }

    if (!user.is_active) {
      throw new AppError('Cuenta desactivada', 403, 'ACCOUNT_DISABLED');
    }

    const isPasswordValid = await bcrypt.compare(data.password, user.password);

    if (!isPasswordValid) {
      throw new AppError('Credenciales incorrectas', 401, 'INVALID_CREDENTIALS');
    }

    const tokenPayload = {
      userId: user.id,
      name: user.name,
      role: user.role,
    };

    const token = generateToken(tokenPayload);

    registerActivity(user.id);

    return {
      message: 'Inicio de sesion exitoso',
      token,
      expiresIn: env.JWT_EXPIRES_IN,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
      },
    };
  }

  static async googleLogin(token: string): Promise<ILoginResponse> {
    const { OAuth2Client } = await import('google-auth-library');
    const client = new OAuth2Client(env.GOOGLE_CLIENT_ID);
    let payload;
    try {
      const ticket = await client.verifyIdToken({
        idToken: token,
        audience: env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch (e) {
      throw new AppError('Token de Google inválido', 401, 'INVALID_GOOGLE_TOKEN');
    }

    if (!payload || !payload.email || !payload.sub) {
      throw new AppError('No se pudo obtener información del usuario de Google', 400, 'INVALID_GOOGLE_PAYLOAD');
    }

    const email = payload.email;
    const googleId = payload.sub;

    let user: IUser | null = await UserModel.findByGoogleId(googleId);

    if (!user) {
      // Intentar buscar por email en caso de que exista de forma tradicional
      user = await UserModel.findByName(email);
      if (user) {
        // Enlazar la cuenta
        await database.query('UPDATE users SET google_id = $1 WHERE id = $2', [googleId, user.id]);
      }
    }

    if (user && !user.is_active) {
      throw new AppError('Cuenta desactivada', 403, 'ACCOUNT_DISABLED');
    }

    if (!user) {
      // Create the user
      // Provide a random password since password is NOT NULL in the DB
      const randomPassword = require('crypto').randomBytes(16).toString('hex');
      const hashedPassword = await bcrypt.hash(randomPassword, 10);
      user = await UserModel.create({
        name: email,
        password: hashedPassword,
        role: Role.USER,
        is_active: true,
        google_id: googleId,
      });
    }

    const tokenPayload = {
      userId: user.id,
      name: user.name,
      role: user.role,
    };

    const jwtToken = generateToken(tokenPayload);

    registerActivity(user.id);

    return {
      message: 'Inicio de sesion exitoso con Google',
      token: jwtToken,
      expiresIn: env.JWT_EXPIRES_IN,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
      },
    };
  }
}