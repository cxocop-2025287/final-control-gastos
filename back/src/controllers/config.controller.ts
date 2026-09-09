import { Request, Response } from 'express';
import { env } from '../config/env';
import { getActivityTimeout } from '../middleware/activity.middleware';

export class ConfigController {
  static async getConfig(req: Request, res: Response): Promise<void> {
    res.status(200).json({
      sessionInactivityTimeout: env.SESSION_INACTIVITY_TIMEOUT || 60,
      googleClientId: env.GOOGLE_CLIENT_ID,
    });
  }
}