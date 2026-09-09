import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, HostListener, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

declare var google: any;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  baseX: number;
  baseY: number;
}

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.html',
  styleUrls: ['./login.css']
})
export class LoginComponent implements AfterViewInit, OnDestroy {
  @ViewChild('particleCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('leftPanel') leftPanelRef!: ElementRef<HTMLDivElement>;

  private ctx!: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private animationFrameId!: number;

  private mouse = {
    x: -1000,
    y: -1000,
    radius: 180
  };

  showPassword = false;
  isLoading = false;
  name = '';
  password = '';
  errorMessage = '';
  successMessage = '';

  constructor(
    private authService: AuthService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  async ngAfterViewInit(): Promise<void> {
    this.initCanvas();
    this.animate();

    try {
      const config = await this.authService.reloadConfig();
      if (config && config.googleClientId) {
        this.initGoogleSignIn(config.googleClientId);
      }
    } catch (e) {
      console.error('Failed to load config for Google Sign-In', e);
    }
  }

  private initGoogleSignIn(clientId: string, retryCount = 0): void {
    if (typeof google === 'undefined' || !google.accounts) {
      if (retryCount < 20) {
        setTimeout(() => this.initGoogleSignIn(clientId, retryCount + 1), 300);
      } else {
        console.warn('Google scripts not loaded after multiple attempts');
      }
      return;
    }
    
    google.accounts.id.initialize({
      client_id: clientId,
      callback: this.handleGoogleCredentialResponse.bind(this)
    });

    const btnContainer = document.getElementById('google-btn-container');
    if (btnContainer) {
      google.accounts.id.renderButton(
        btnContainer,
        { theme: 'outline', size: 'large', type: 'standard', width: '340' }
      );
    }
  }

  private handleGoogleCredentialResponse(response: any): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';
    this.cdr.detectChanges();

    this.authService.googleLogin(response.credential).subscribe({
      next: (res) => {
        this.isLoading = false;
        this.successMessage = res.message;
        this.cdr.detectChanges();
        setTimeout(() => {
          this.router.navigate(['/app']);
        }, 1000);
      },
      error: (error) => {
        this.isLoading = false;
        if (error.error?.errorCode === 'ACCOUNT_DISABLED') {
          this.errorMessage = 'Esta cuenta no está habilitada para iniciar sesión.';
        } else {
          this.errorMessage = 'Error en autenticación de Google. Intente nuevamente.';
        }
        this.cdr.detectChanges();
      }
    });
  }

  ngOnDestroy(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
  }

  @HostListener('window:resize')
  onResize(): void {
    this.initCanvas();
  }

  onMouseMove(event: MouseEvent): void {
    const rect = this.leftPanelRef.nativeElement.getBoundingClientRect();
    this.mouse.x = event.clientX - rect.left;
    this.mouse.y = event.clientY - rect.top;
  }

  private initCanvas(): void {
    const canvas = this.canvasRef.nativeElement;
    const panel = this.leftPanelRef.nativeElement;

    canvas.width = panel.clientWidth;
    canvas.height = panel.clientHeight;
    this.ctx = canvas.getContext('2d')!;

    this.particles = [];
    const particleCount = Math.floor((canvas.width * canvas.height) / 6500);

    for (let i = 0; i < particleCount; i++) {
      const x = Math.random() * canvas.width;
      const y = Math.random() * canvas.height;
      this.particles.push({
        x,
        y,
        baseX: x,
        baseY: y,
        vx: (Math.random() - 0.5) * 0.8,
        vy: (Math.random() - 0.5) * 0.8,
        radius: Math.random() * 2 + 1.2
      });
    }
  }

  private animate = (): void => {
    const canvas = this.canvasRef.nativeElement;
    this.ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];

      p.x += p.vx;
      p.y += p.vy;

      if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
      if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

      const dx = this.mouse.x - p.x;
      const dy = this.mouse.y - p.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < this.mouse.radius) {
        const force = (this.mouse.radius - distance) / this.mouse.radius;
        const moveX = (dx / distance) * force * 4.5;
        const moveY = (dy / distance) * force * 4.5;

        p.x += moveX;
        p.y += moveY;
      }

      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      this.ctx.fill();

      for (let j = i + 1; j < this.particles.length; j++) {
        const p2 = this.particles[j];
        const pDistance = Math.hypot(p.x - p2.x, p.y - p2.y);

        if (pDistance < 110) {
          const alpha = 1 - pDistance / 110;
          this.ctx.beginPath();
          this.ctx.moveTo(p.x, p.y);
          this.ctx.lineTo(p2.x, p2.y);
          this.ctx.strokeStyle = `rgba(145, 191, 6, ${alpha * 0.4})`;
          this.ctx.lineWidth = 0.8;
          this.ctx.stroke();
        }
      }

      if (distance < this.mouse.radius) {
        const alpha = 1 - distance / this.mouse.radius;
        this.ctx.beginPath();
        this.ctx.moveTo(p.x, p.y);
        this.ctx.lineTo(this.mouse.x, this.mouse.y);
        this.ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.55})`;
        this.ctx.lineWidth = 1;
        this.ctx.stroke();
      }
    }

    this.animationFrameId = requestAnimationFrame(this.animate);
  };

  togglePassword(): void {
    this.showPassword = !this.showPassword;
  }

  onSubmit(): void {
    this.errorMessage = '';
    this.successMessage = '';

    if (!this.name.trim() || !this.password.trim()) {
      this.errorMessage = 'Por favor, complete todos los campos.';
      this.cdr.detectChanges();
      return;
    }

    this.isLoading = true;
    this.cdr.detectChanges();

    this.authService.login(this.name.trim(), this.password).subscribe({
      next: (response) => {
        this.isLoading = false;
        this.successMessage = response.message;
        this.cdr.detectChanges();
        setTimeout(() => {
          this.router.navigate(['/app']);
        }, 1000);
      },
      error: (error) => {
        this.isLoading = false;

        if (error.error?.errorCode === 'INVALID_CREDENTIALS') {
          this.errorMessage = 'El usuario o la contraseña son incorrectos.';
        } else if (error.error?.errorCode === 'ACCOUNT_DISABLED') {
          this.errorMessage = 'Esta cuenta no está habilitada para iniciar sesión.';
        } else if (error.status === 0) {
          this.errorMessage = 'No se pudo conectar con el servidor. Verifique que el backend esté corriendo.';
        } else {
          this.errorMessage = 'Ocurrió un error inesperado. Intente nuevamente.';
        }

        this.cdr.detectChanges();
      },
    });
  }
}