import { Routes } from '@angular/router';
import { AuthGuard } from './guards/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () =>
      import('./pages/login/login').then((m) => m.LoginComponent),
  },
  {
    path: 'app',
    canActivate: [AuthGuard],
    loadComponent: () =>
      import('./pages/dashboard/dashboard').then((m) => m.DashboardComponent),
  },
  {
    path: 'ingresos',
    canActivate: [AuthGuard],
    loadComponent: () =>
      import('./pages/ingresos/ingresos').then((m) => m.IngresosComponent),
  },
  {
    path: 'gastos',
    canActivate: [AuthGuard],
    loadComponent: () =>
      import('./pages/gastos/gastos').then((m) => m.GastosComponent),
  },
  {
    path: 'deudas',
    canActivate: [AuthGuard],
    loadComponent: () =>
      import('./pages/deudas/deudas').then((m) => m.DeudasComponent),
  },
  {
    path: 'resumen',
    canActivate: [AuthGuard],
    loadComponent: () =>
      import('./pages/resumen/resumen').then((m) => m.ResumenComponent),
  },
  {
    path: '',
    redirectTo: 'app',
    pathMatch: 'full',
  },
  {
    path: '**',
    redirectTo: 'app',
  },
];