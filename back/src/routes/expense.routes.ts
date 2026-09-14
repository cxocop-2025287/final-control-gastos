import { Router } from 'express';
import { ExpenseController } from '../controllers/expense.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { activityMiddleware } from '../middleware/activity.middleware';

const router = Router();

router.use(authMiddleware);
router.use(activityMiddleware);

router.get('/', ExpenseController.getAll);
router.get('/summary', ExpenseController.getSummary);
router.get('/balance', ExpenseController.getBalance);
router.get('/categories', ExpenseController.getCategories);
router.post('/', ExpenseController.create);
router.put('/:id', ExpenseController.update);
router.delete('/:id', ExpenseController.delete);

export default router;