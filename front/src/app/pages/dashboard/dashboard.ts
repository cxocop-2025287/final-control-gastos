import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subscription, finalize } from 'rxjs';
import { AuthService, User } from '../../services/auth.service';
import {
  DashboardService,
  DashboardSummary,
  Movement,
  ChartPoint,
} from '../../services/dashboard.service';
import { DebtProgress, EMPTY_DEBT_PROGRESS } from '../../models/debt.model';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class DashboardComponent implements OnInit, OnDestroy {
  user: User | null = null;
  showSessionExpired = false;
  loading = true;
  private sessionSub?: Subscription;

  activeNav = 'Home';
  navItems = ['Home', 'Gastos', 'Ingresos', 'Deudas', 'Resumen'];

  summary: DashboardSummary = { saldoTotal: 0, ingreso: 0, gasto: 0, ahorroMensual: 0 };
  movements: Movement[] = [];
  chartData: ChartPoint[] = [];
  debtProgress: DebtProgress = EMPTY_DEBT_PROGRESS;

  chartPath = '';
  chartArea = '';
  chartDots: { x: number; y: number; leftPct: number; topPct: number; label: string; sub: string }[] = [];
  chartLabels: string[] = [];
  chartMaxValue = 0;
  chartYLabels: string[] = [];
  currentMonth = '';

  /** Punto de la gráfica sobre el que está el mouse (para el tooltip); -1 = ninguno */
  chartHoverIndex = -1;

  get hoveredDot(): { x: number; y: number; leftPct: number; topPct: number; label: string; sub: string } | null {
    return this.chartHoverIndex >= 0 && this.chartDots[this.chartHoverIndex]
      ? this.chartDots[this.chartHoverIndex]
      : null;
  }

  debtOffset = 314.16;
  displayedPorcentaje = 0;
  displayedSummary: DashboardSummary = { saldoTotal: 0, ingreso: 0, gasto: 0, ahorroMensual: 0 };

  constructor(
    private authService: AuthService,
    private dashboardService: DashboardService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit(): Promise<void> {
    this.user = this.authService.getUser();

    await this.authService.reloadConfig();

    this.sessionSub = this.authService.sessionExpired$.subscribe(() => {
      this.showSessionExpired = true;
      this.cdr.detectChanges();
    });

    this.loadData();
  }

  ngOnDestroy(): void {
    this.sessionSub?.unsubscribe();
  }

  private loadData(): void {
    this.loading = true;
    const now = new Date();
    this.currentMonth = now.toLocaleDateString('es-GT', { month: 'long', year: 'numeric' });

    console.log(`📅 Dashboard - Mes actual: ${this.currentMonth}`);

    this.dashboardService.loadDashboardData()
      .pipe(finalize(() => {
        this.loading = false;
        this.cdr.detectChanges();
      }))
      .subscribe({
        next: (data) => {
          this.summary = data.summary;
          this.movements = data.movements.slice(0, 10);
          this.chartData = data.chartData;
          this.debtProgress = data.debtProgress;

          this.debtOffset = 314.16 - (314.16 * this.debtProgress.porcentaje) / 100;
          this.displayedPorcentaje = this.debtProgress.porcentaje;

          this.buildChart();
          this.animateCounters();
        },
        error: (err) => {
          console.error('Error cargando dashboard:', err);
          this.summary = { saldoTotal: 0, ingreso: 0, gasto: 0, ahorroMensual: 0 };
          this.chartData = [];
          this.buildChart();
          this.animateCounters();
        }
      });
  }

  private animateCounters(): void {
    const duration = 1200;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      this.displayedSummary = {
        saldoTotal: this.summary.saldoTotal * eased,
        ingreso: this.summary.ingreso * eased,
        gasto: this.summary.gasto * eased,
        ahorroMensual: this.summary.ahorroMensual * eased,
      };
      this.cdr.detectChanges();
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  onNavClick(item: string): void {
  if (item !== 'Home' && item !== 'Gastos' && item !== 'Ingresos' && item !== 'Deudas' && item !== 'Resumen') return;

  if (item === 'Gastos') {
    this.router.navigate(['/gastos']);
    return;
  }
  if (item === 'Ingresos') {
    this.router.navigate(['/ingresos']);
    return;
  }
  if (item === 'Deudas') {
    this.router.navigate(['/deudas']);
    return;
  }
  if (item === 'Resumen') {
    this.router.navigate(['/resumen']);
    return;
  }
  // Home: ya estamos en /app, no hacemos nada
  this.activeNav = item;
}

  onLogout(): void {
    this.authService.logout();
  }

  onAcceptSessionExpired(): void {
    this.showSessionExpired = false;
    this.authService.confirmSessionExpired();
  }

  onChartHover(index: number): void {
    this.chartHoverIndex = index;
  }

  formatCurrency(value: number): string {
    const num = typeof value === 'number' ? value : parseFloat(String(value)) || 0;
    return 'Q' + num.toFixed(2);
  }

  formatCurrencyShort(value: number): string {
    const num = typeof value === 'number' ? value : parseFloat(String(value)) || 0;
    if (num >= 1000) {
      return 'Q' + (num / 1000).toFixed(1) + 'k';
    }
    return 'Q' + num.toFixed(0);
  }

  formatDate(dateStr: string): string {
    if (!dateStr) return 'Fecha no disponible';
    try {
      const parts = String(dateStr).split('T')[0].split('-');
      let d: Date;
      if (parts.length >= 3) {
        d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      } else {
        d = new Date(dateStr);
      }
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString('es-GT', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      });
    } catch {
      return dateStr;
    }
  }

  /**
   * Construye la gráfica de flujo de dinero.
   *
   *  - 4 columnas fijas: Semana 1 a Semana 4.
   *  - La curva solo dibuja puntos hasta la semana actual (las futuras quedan vacías).
   *  - El eje Y muestra etiquetas redondas (múltiplos limpios) abreviadas con k/M/B.
   */
  private buildChart(): void {
    const data = this.chartData || [];
    const totalWeeks = 4;

    const width = 500;
    const height = 200;
    const paddingY = 16;

    // Máximo real considerando solo valores no nulos.
    let maxVal = 0;
    for (const d of data) {
      if (d.valor !== null && d.valor !== undefined) {
        maxVal = Math.max(maxVal, d.valor);
      }
    }

    // Candidatos para el step "bonito" (10, 20, 25, 50, 100, 200, 250, 500 * 10^n).
    const niceStepCandidates: number[] = [];
    const bases = [10, 20, 25, 50, 100, 200, 250, 500];
    for (let exp = 0; exp <= 12; exp++) {
      for (const b of bases) {
        niceStepCandidates.push(b * Math.pow(10, exp));
      }
    }
    niceStepCandidates.sort((a, b) => a - b);

    const targetTop = Math.max(maxVal * 1.33, 100);
    let step = niceStepCandidates[niceStepCandidates.length - 1];
    for (const c of niceStepCandidates) {
      if (4 * c >= targetTop) {
        step = c;
        break;
      }
    }

    const topVal = 4 * step;

    this.chartMaxValue = topVal;
    this.chartPath = '';
    this.chartArea = '';
    this.chartDots = [];
    this.chartLabels = ['Semana 1', 'Semana 2', 'Semana 3', 'Semana 4'];
    this.chartYLabels = [];

    // Abreviación con k / M / B.
    const fmtLabel = (v: number): string => {
      if (v === 0) return 'Q0';
      const abs = Math.abs(v);
      const sign = v < 0 ? '-' : '';
      if (abs < 1000) return `Q${sign}${Math.round(abs)}`;
      if (abs < 1_000_000) {
        const n = abs / 1000;
        return `Q${sign}${n % 1 === 0 ? n.toFixed(0) : n.toFixed(1)}k`;
      }
      if (abs < 1_000_000_000) {
        const n = abs / 1_000_000;
        return `Q${sign}${n % 1 === 0 ? n.toFixed(0) : n.toFixed(1)}M`;
      }
      const n = abs / 1_000_000_000;
      return `Q${sign}${n % 1 === 0 ? n.toFixed(0) : n.toFixed(1)}B`;
    };

    for (let i = 0; i < 5; i++) {
      const v = topVal - step * i;
      this.chartYLabels.push(fmtLabel(v));
    }

    const usableHeight = height - paddingY * 2;
    const toY = (val: number) => {
      const clamped = Math.max(0, val);
      return height - paddingY - (clamped / topVal) * usableHeight;
    };

    const fmt = (n: number) => 'Q' + n.toFixed(2);

    // 4 columnas fijas.
    const colWidth = width / totalWeeks;
    const allColumns: { x: number; y: number; leftPct: number; topPct: number; label: string; sub: string }[] = [];

    for (let i = 0; i < totalWeeks; i++) {
      const point = data[i] || { valor: null, ingresos: null, gastos: null };
      const x = colWidth * i + colWidth / 2;

      if (point.valor === null || point.valor === undefined) {
        // Semana futura: no dibujamos punto. Reservamos la columna con y = -1.
        allColumns.push({
          x,
          y: -1,
          leftPct: 0,
          topPct: 0,
          label: '',
          sub: '',
        });
        continue;
      }

      const val = Math.max(0, point.valor);
      const ingresos = point.ingresos || 0;
      const gastos = point.gastos || 0;
      const y = toY(val);

      let leftPct = Math.round((x / width) * 10000) / 100;
      let topPct = Math.round((y / height) * 10000) / 100;
      if (leftPct < 14) leftPct = 14;
      if (leftPct > 86) leftPct = 86;
      if (topPct < 16) topPct = 16;
      if (topPct > 92) topPct = 92;

      allColumns.push({
        x,
        y,
        leftPct,
        topPct,
        label: this.chartLabels[i],
        sub: `Saldo ${fmt(val)} · +${fmt(ingresos)} / -${fmt(gastos)}`,
      });
    }

    // Solo los puntos con valor (no null) se usan para dibujar la curva.
    const dotPoints = allColumns.filter((c) => c.y >= 0);

    if (dotPoints.length === 0) {
      this.chartPath = '';
      this.chartArea = '';
      this.chartDots = [];
      return;
    }

    // La curva empieza en x=0 y termina en el último punto con valor.
    const first = dotPoints[0];
    const last = dotPoints[dotPoints.length - 1];

    const curvePoints: { x: number; y: number }[] = [
      { x: 0, y: first.y },
      ...dotPoints.map((d) => ({ x: d.x, y: d.y })),
      { x: last.x, y: last.y },
    ];

    let path = `M${curvePoints[0].x},${curvePoints[0].y}`;
    for (let i = 1; i < curvePoints.length; i++) {
      const prev = curvePoints[i - 1];
      const cur = curvePoints[i];
      const cpX = (prev.x + cur.x) / 2;
      path += ` C${cpX},${prev.y} ${cpX},${cur.y} ${cur.x},${cur.y}`;
    }

    const baseY = height - paddingY;
    this.chartPath = path;

    const allZero = dotPoints.every((p) => Math.abs(p.y - baseY) < 1);
    this.chartArea = allZero ? '' : `${path} L${last.x},${baseY} L0,${baseY} Z`;
    this.chartDots = dotPoints;
  }
}