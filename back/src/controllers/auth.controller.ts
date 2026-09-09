import { Request, Response } from 'express';
import { AuthService, AppError } from '../services/auth.service';

export class AuthController {
  static async login(req: Request, res: Response): Promise<void> {
    try {
      const { name, password } = req.body;

      if (!name || !password) {
        res.status(400).json({
          message: 'Todos los campos son obligatorios',
          errorCode: 'MISSING_FIELDS',
        });
        return;
      }

      const result = await AuthService.login({ name, password });
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({
          message: error.message,
          errorCode: error.errorCode,
        });
        return;
      }

      console.error('Error inesperado en login:', error);
      res.status(500).json({
        message: 'Error interno del servidor',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  static async googleLogin(req: Request, res: Response): Promise<void> {
    try {
      const { token } = req.body;
      if (!token) {
        res.status(400).json({
          message: 'Falta el token de Google',
          errorCode: 'MISSING_FIELDS',
        });
        return;
      }
      const result = await AuthService.googleLogin(token);
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({
          message: error.message,
          errorCode: error.errorCode,
        });
        return;
      }

      console.error('Error inesperado en googleLogin:', error);
      res.status(500).json({
        message: 'Error interno del servidor',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}