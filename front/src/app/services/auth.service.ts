import { Injectable, signal, computed, NgZone } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap, Subject, firstValueFrom } from 'rxjs';

export interface LoginResponse {
  message: string;
  token: string;
  expiresIn: string;
  user: {
    id: string;
    name: string;
    role: string;
  };
}

export interface User {
  id: string;
  name: string;
  role: string;
}

const ACTIVITY_EVENTS = ['click', 'mousemove', 'keydown', 'scroll', 'touchstart', 'wheel', 'mousedown', 'keyup'];

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly TOKEN_KEY = 'auth_token';
  private readonly USER_KEY = 'auth_user';
  private readonly LAST_ACTIVITY_KEY = 'auth_last_activity';

  private currentUser = signal<User | null>(this.loadUser());
  readonly user = computed(() => this.currentUser());
  readonly isAuthenticated = computed(() => !!this.currentUser());
  readonly userRole = computed(() => this.currentUser()?.role || null);

  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private boundActivityHandler = this.onUserActivity.bind(this);
  private _sessionExpired = new Subject<void>();
  readonly sessionExpired$ = this._sessionExpired.asObservable();

  private isSessionExpired = false;
  private inactivityTimeoutMs = 60 * 1000;
  private lastHeartbeatTime = 0;

  /** Flag para evitar arrancar múltiples monitores al navegar entre vistas */
  private isMonitorRunning = false;
  /** Flag para saber si la config ya fue cargada al menos una vez */
  private configLoaded = false;

  constructor(
    private http: HttpClient,
    private router: Router,
    private ngZone: NgZone
  ) {
    this.loadConfig();
    this.checkSessionOnInit();
  }

  private checkSessionOnInit(): void {
    const token = this.getToken();
    if (token && this.isLoggedIn() && this.currentUser()) {
      console.log('🔄 Sesión activa detectada al iniciar');
      this.startMonitorIfNeeded();
    }
  }

  /**
   * Llamado desde cada componente (Dashboard, Ingresos) al inicializarse.
   * Solo recarga la config si no se ha cargado aún, y solo inicia el
   * monitor si no está corriendo. NO resetea el timer de actividad.
   */
  async reloadConfig(): Promise<{ sessionInactivityTimeout: number, googleClientId: string } | undefined> {
    let config;
    if (!this.configLoaded) {
      config = await this.loadConfig();
    } else {
      config = await firstValueFrom(this.http.get<{ sessionInactivityTimeout: number, googleClientId: string }>('/api/config'));
    }
    this.startMonitorIfNeeded();
    return config;
  }

  private async loadConfig(): Promise<{ sessionInactivityTimeout: number, googleClientId: string }> {
    try {
      const config = await firstValueFrom(
        this.http.get<{ sessionInactivityTimeout: number, googleClientId: string }>('/api/config')
      );
      const newTimeout = (config.sessionInactivityTimeout || 60) * 1000;

      if (this.inactivityTimeoutMs !== newTimeout) {
        this.inactivityTimeoutMs = newTimeout;
        console.log(`⏱️ Tiempo de inactividad: ${this.inactivityTimeoutMs / 1000} segundos`);

        // Si el timeout cambió y ya hay un monitor corriendo, reiniciarlo con el nuevo valor
        if (this.isMonitorRunning) {
          this.stopMonitor();
          this.startMonitorIfNeeded();
        }
      }

      this.configLoaded = true;
      return config;
    } catch (error) {
      console.error('Error cargando configuración:', error);
      throw error;
    }
  }

  login(name: string, password: string): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>('/api/auth/login', { name, password })
      .pipe(
        tap(async (response) => {
          this.isSessionExpired = false;
          this.configLoaded = false; // Forzar recarga de config tras login
          await this.loadConfig();
          this.setSession(response.token, response.user);
        })
      );
  }

  googleLogin(credential: string): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>('/api/auth/google', { token: credential })
      .pipe(
        tap(async (response) => {
          this.isSessionExpired = false;
          this.configLoaded = false;
          await this.loadConfig();
          this.setSession(response.token, response.user);
        })
      );
  }

  logout(): void {
    this.stopMonitor();
    this.removeActivityListeners();
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
    localStorage.removeItem(this.LAST_ACTIVITY_KEY);
    this.currentUser.set(null);
    this.isSessionExpired = false;
    this.router.navigate(['/login']);
  }

  getToken(): string | null {
    return localStorage.getItem(this.TOKEN_KEY);
  }

  isLoggedIn(): boolean {
    const token = this.getToken();
    if (!token) return false;

    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const expiry = payload.exp * 1000;
      return Date.now() < expiry;
    } catch {
      return false;
    }
  }

  getUser(): User | null {
    return this.currentUser();
  }

  getRole(): string | null {
    return this.currentUser()?.role || null;
  }

  private setSession(token: string, user: User): void {
    localStorage.setItem(this.TOKEN_KEY, token);
    localStorage.setItem(this.USER_KEY, JSON.stringify(user));
    localStorage.setItem(this.LAST_ACTIVITY_KEY, Date.now().toString());
    this.currentUser.set(user);
    this.startMonitorIfNeeded();
  }

  /**
   * Llamado cuando el usuario hace una acción real (click, mousemove, etc.)
   * Actualiza el timestamp de última actividad y envía heartbeat al backend.
   */
  private onUserActivity(): void {
    if (!this.currentUser() || this.isSessionExpired) return;
    const now = Date.now();
    localStorage.setItem(this.LAST_ACTIVITY_KEY, now.toString());
    this.sendHeartbeat();
  }

  /**
   * Inicia el monitor de inactividad y heartbeat SOLO si no está ya corriendo.
   */
  private startMonitorIfNeeded(): void {
    if (this.isMonitorRunning) return;
    if (!this.currentUser() || !this.getToken() || !this.isLoggedIn()) return;

    this.isMonitorRunning = true;
    this.addActivityListeners();

    this.ngZone.runOutsideAngular(() => {
      // Check de inactividad cada segundo
      this.checkInterval = setInterval(() => {
        this.checkInactivity();
      }, 1000);

      // Heartbeat al backend cada 10s (solo si hay actividad reciente)
      this.heartbeatInterval = setInterval(() => {
        if (!this.currentUser() || this.isSessionExpired) {
          return;
        }
        // Solo enviar heartbeat si el usuario tuvo actividad en los últimos 10s
        const lastActivity = localStorage.getItem(this.LAST_ACTIVITY_KEY);
        if (lastActivity) {
          const elapsed = Date.now() - parseInt(lastActivity, 10);
          if (elapsed < 10000) {
            this.sendHeartbeat();
          }
        }
      }, 10000);
    });

    console.log(`🔄 Monitor de inactividad iniciado (${this.inactivityTimeoutMs / 1000}s)`);
  }

  private checkInactivity(): void {
    if (this.isSessionExpired) return;
    if (!this.currentUser()) return;

    const lastActivity = localStorage.getItem(this.LAST_ACTIVITY_KEY);
    if (!lastActivity) {
      this.handleSessionExpired();
      return;
    }

    const lastActivityTime = parseInt(lastActivity, 10);
    const now = Date.now();
    const inactiveTime = now - lastActivityTime;

    if (inactiveTime > this.inactivityTimeoutMs) {
      console.log(`⏰ Inactividad detectada: ${Math.round(inactiveTime / 1000)}s (límite: ${Math.round(this.inactivityTimeoutMs / 1000)}s)`);
      this.handleSessionExpired();
    }
  }

  private stopMonitor(): void {
    this.isMonitorRunning = false;
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private sendHeartbeat(): void {
    const token = this.getToken();
    if (!token || this.isSessionExpired) return;

    const now = Date.now();
    // Throttle: mínimo 5 segundos entre heartbeats
    if (now - this.lastHeartbeatTime < 5000) {
      return;
    }
    this.lastHeartbeatTime = now;

    this.http.get('/api/activity/heartbeat').subscribe({
      next: (response: any) => {
        if (response.isActive === false) {
          console.log('⏰ Backend reporta sesión inactiva');
          this.handleSessionExpired();
        }
      },
      error: (error) => {
        if (error.status === 401 || error.status === 403) {
          console.log('⏰ Backend rechazó heartbeat (sesión expirada)');
          this.handleSessionExpired();
        }
      }
    });
  }

  private addActivityListeners(): void {
    this.ngZone.runOutsideAngular(() => {
      ACTIVITY_EVENTS.forEach((event) => {
        window.addEventListener(event, this.boundActivityHandler, { passive: true });
      });
    });
    console.log('👆 Listeners de actividad agregados');
  }

  private removeActivityListeners(): void {
    ACTIVITY_EVENTS.forEach((event) => {
      window.removeEventListener(event, this.boundActivityHandler);
    });
  }

  handleSessionExpired(): void {
    if (this.isSessionExpired) return;
    this.isSessionExpired = true;

    this.stopMonitor();
    this.removeActivityListeners();
    this._sessionExpired.next();

    console.log('⏰ Sesión expirada por inactividad');
  }

  confirmSessionExpired(): void {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
    localStorage.removeItem(this.LAST_ACTIVITY_KEY);
    this.currentUser.set(null);
    this.isSessionExpired = false;
    this.configLoaded = false;
    this.router.navigate(['/login']);
  }

  clearSession(): void {
    this.isSessionExpired = true;
    this.stopMonitor();
    this.removeActivityListeners();
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
    localStorage.removeItem(this.LAST_ACTIVITY_KEY);
    this.currentUser.set(null);
  }

  private loadUser(): User | null {
    const token = localStorage.getItem(this.TOKEN_KEY);
    const userJson = localStorage.getItem(this.USER_KEY);

    if (!token || !userJson) return null;

    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const expiry = payload.exp * 1000;

      if (Date.now() >= expiry) {
        localStorage.removeItem(this.TOKEN_KEY);
        localStorage.removeItem(this.USER_KEY);
        localStorage.removeItem(this.LAST_ACTIVITY_KEY);
        return null;
      }

      return JSON.parse(userJson);
    } catch {
      localStorage.removeItem(this.TOKEN_KEY);
      localStorage.removeItem(this.USER_KEY);
      localStorage.removeItem(this.LAST_ACTIVITY_KEY);
      return null;
    }
  }

  resetInactivityTimer(): void {
    this.onUserActivity();
  }
}