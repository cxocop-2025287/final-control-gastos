import { HttpInterceptorFn } from '@angular/common/http';
import { inject, Injector } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

let isSessionExpiredShown = false;

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const injector = inject(Injector);

  if (req.url.includes('/auth/login') || req.url.includes('/auth/google') || req.url.includes('/config')) {
    return next(req);
  }

  const authService = injector.get(AuthService);
  const token = authService.getToken();

  if (token) {
    req = req.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`,
      },
    });
  }

  return next(req).pipe(
    catchError((error) => {
      if (
        (error.status === 401 || error.status === 403) &&
        !isSessionExpiredShown
      ) {
        isSessionExpiredShown = true;

        // Si el backend dice SESSION_EXPIRED, mostrar modal en vez de solo limpiar
        const errorCode = error.error?.errorCode;
        if (errorCode === 'SESSION_EXPIRED' || errorCode === 'TOKEN_EXPIRED') {
          authService.handleSessionExpired();
        } else {
          authService.clearSession();
        }

        setTimeout(() => {
          isSessionExpiredShown = false;
        }, 3000);
      }

      return throwError(() => error);
    })
  );
};