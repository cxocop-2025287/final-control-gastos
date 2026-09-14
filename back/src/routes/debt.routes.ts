import { Router } from 'express';
import { DebtController } from '../controllers/debt.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { activityMiddleware } from '../middleware/activity.middleware';

const router = Router();

router.use(authMiddleware);
router.use(activityMiddleware);

router.get('/', DebtController.getAll);
router.get('/progress', DebtController.getProgress);
router.post('/cleanup-orphans', DebtController.cleanupOrphanExpenses);
router.get('/:id', DebtController.getById);
router.post('/', DebtController.create);
router.put('/:id', DebtController.update);
router.delete('/:id', DebtController.remove);
router.post('/:id/payments', DebtController.registerPayment);
router.put('/:id/payments/:paymentId', DebtController.updatePayment);
router.delete('/:id/payments/:paymentId', DebtController.deletePayment);

export default router;