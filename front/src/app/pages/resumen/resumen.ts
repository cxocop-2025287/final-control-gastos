import { Component, OnInit, OnDestroy, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription, finalize } from 'rxjs';
import { AuthService, User } from '../../services/auth.service';
import { SummaryService, SummaryMovement } from '../../services/summary.service';

type DateFilterMode = 'mes' | 'anio' | 'personalizado' | 'todo';
type OrdenCampo = 'fecha' | 'monto' | 'categoria' | 'descripcion';
type OrdenDir = 'asc' | 'desc';
type DropdownAbierto = 'rango' | 'catIngreso' | 'catGasto' | null;

@Component({
  selector: 'app-resumen',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './resumen.html',
  styleUrls: ['./resumen.css'],
})
export class ResumenComponent implements OnInit, OnDestroy {
  user: User | null = null;
  activeNav = 'Resumen';
  showSessionExpired = false;

  loading = true;
  loadError = '';

  openDropdown: DropdownAbierto = null;

  // Filtros
  dateFilter: DateFilterMode = 'mes';
  selectedDate: string = '';
  fechaDesde: string = '';
  fechaHasta: string = '';
  categoriaIngreso: string | null = null;
  categoriaGasto: string | null = null;
  searchTerm = '';

  // Datos
  allMovements: SummaryMovement[] = [];
  filteredMovements: SummaryMovement[] = [];
  categoriasIngreso: string[] = [];
  categoriasGasto: string[] = [];

  // Orden
  ordenCampo: OrdenCampo = 'fecha';
  ordenDir: OrdenDir = 'desc';

  filteredTotals = {
    totalIngresos: 0,
    totalGastos: 0,
    neto: 0,
  };

  readonly hoy: string = (() => {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  })();

  private subscriptions: Subscription[] = [];
  private sessionSub?: Subscription;

  constructor(
    private authService: AuthService,
    private summaryService: SummaryService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit(): Promise<void> {
    this.user = this.authService.getUser();

    const hoy = new Date();
    this.selectedDate = this.formatDateForBackend(hoy);
    const primerDia = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const ultimoDia = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
    this.fechaDesde = this.formatDateForBackend(primerDia);
    this.fechaHasta = this.formatDateForBackend(ultimoDia);

    await this.authService.reloadConfig();

    this.sessionSub = this.authService.sessionExpired$.subscribe(() => {
      this.showSessionExpired = true;
      this.cdr.detectChanges();
    });

    this.loadData();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
    this.sessionSub?.unsubscribe();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.dropdown')) {
      this.openDropdown = null;
    }
  }

  // ===== Labels =====

  get rangoLabel(): string {
    switch (this.dateFilter) {
      case 'mes': return 'Mes';
      case 'anio': return 'Año';
      case 'personalizado': return 'Rango';
      case 'todo': return 'Todo';
    }
  }

  get categoriaIngresoLabel(): string {
    return this.categoriaIngreso || 'Categoría ingresos';
  }

  get categoriaGastoLabel(): string {
    return this.categoriaGasto || 'Categoría gastos';
  }

  // ===== Dropdowns =====

  toggleDropdown(name: DropdownAbierto): void {
    this.openDropdown = this.openDropdown === name ? null : name;
  }

  setRango(mode: DateFilterMode): void {
    this.dateFilter = mode;
    this.openDropdown = null;
    if (mode !== 'personalizado') {
      this.loadData();
    }
  }

  setCategoriaIngreso(cat: string | null): void {
    this.categoriaIngreso = cat;
    this.openDropdown = null;
    this.applyFilters();
  }

  setCategoriaGasto(cat: string | null): void {
    this.categoriaGasto = cat;
    this.openDropdown = null;
    this.applyFilters();
  }

  // ===== Carga =====

  private formatDateForBackend(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private parseDateLocal(dateStr: string): Date {
    if (!dateStr) return new Date();
    const parts = String(dateStr).split('T')[0].split('-');
    if (parts.length < 3) return new Date(dateStr);
    return new Date(
      parseInt(parts[0], 10),
      parseInt(parts[1], 10) - 1,
      parseInt(parts[2], 10)
    );
  }

  private getDateRange(): { desde?: string; hasta?: string } {
    if (this.dateFilter === 'todo') return {};

    if (this.dateFilter === 'personalizado') {
      return {
        desde: this.fechaDesde || undefined,
        hasta: this.fechaHasta || undefined,
      };
    }

    const date = this.parseDateLocal(this.selectedDate);
    if (this.dateFilter === 'mes') {
      const desde = new Date(date.getFullYear(), date.getMonth(), 1);
      const hasta = new Date(date.getFullYear(), date.getMonth() + 1, 0);
      return {
        desde: this.formatDateForBackend(desde),
        hasta: this.formatDateForBackend(hasta),
      };
    }

    const desde = new Date(date.getFullYear(), 0, 1);
    const hasta = new Date(date.getFullYear(), 11, 31);
    return {
      desde: this.formatDateForBackend(desde),
      hasta: this.formatDateForBackend(hasta),
    };
  }

  loadData(): void {
    this.loading = true;
    this.loadError = '';

    const { desde, hasta } = this.getDateRange();

    this.subscriptions.push(
      this.summaryService
        .load(desde, hasta)
        .pipe(
          finalize(() => {
            this.loading = false;
            this.cdr.detectChanges();
          })
        )
        .subscribe({
          next: (result) => {
            this.allMovements = result.movements;

            // Categorías separadas por tipo
            const setIng = new Set<string>();
            const setGas = new Set<string>();
            for (const m of result.movements) {
              if (m.tipo === 'ingreso') setIng.add(m.categoria);
              else setGas.add(m.categoria);
            }
            this.categoriasIngreso = Array.from(setIng).sort((a, b) => a.localeCompare(b));
            this.categoriasGasto = Array.from(setGas).sort((a, b) => a.localeCompare(b));

            this.applyFilters();
            this.cdr.detectChanges();
          },
          error: (err) => {
            console.error('Error al cargar el resumen:', err);
            this.loadError = 'Error al cargar los datos. Intente nuevamente.';
            this.allMovements = [];
            this.categoriasIngreso = [];
            this.categoriasGasto = [];
            this.applyFilters();
            this.cdr.detectChanges();
          },
        })
    );
  }

  applyFilters(): void {
  let filtered = [...this.allMovements];

  // Reglas:
  //  - Cada dropdown de categoría actúa SOLO sobre su tipo (ingresos o gastos).
  //  - Si el dropdown está en "Todas" (null), ese tipo se muestra completo.
  //  - Si el dropdown tiene una categoría específica, ese tipo se filtra.
  //  - El otro tipo siempre se muestra completo (nunca se oculta).
  filtered = filtered.filter((m) => {
    if (m.tipo === 'ingreso') {
      if (!this.categoriaIngreso) return true; // Todas
      return m.categoria === this.categoriaIngreso;
    } else {
      if (!this.categoriaGasto) return true; // Todas
      return m.categoria === this.categoriaGasto;
    }
  });

  if (this.searchTerm.trim()) {
    const term = this.searchTerm.trim().toLowerCase();
    filtered = filtered.filter(
      (m) =>
        m.descripcion.toLowerCase().includes(term) ||
        m.categoria.toLowerCase().includes(term)
    );
  }

  filtered.sort((a, b) => {
    let cmp = 0;
    switch (this.ordenCampo) {
      case 'fecha':
        cmp = String(a.fecha).localeCompare(String(b.fecha));
        break;
      case 'monto':
        cmp = a.monto - b.monto;
        break;
      case 'categoria':
        cmp = a.categoria.localeCompare(b.categoria);
        break;
      case 'descripcion':
        cmp = a.descripcion.localeCompare(b.descripcion);
        break;
    }
    if (cmp === 0) cmp = a.id - b.id;
    return this.ordenDir === 'asc' ? cmp : -cmp;
  });

  this.filteredMovements = filtered;

  let totalIngresos = 0;
  let totalGastos = 0;
  for (const m of filtered) {
    if (m.tipo === 'ingreso') totalIngresos += m.monto;
    else totalGastos += m.monto;
  }

  this.filteredTotals = {
    totalIngresos,
    totalGastos,
    neto: totalIngresos - totalGastos,
  };
}

  // ===== UI =====

  onDateChange(): void {
    if (this.dateFilter === 'mes' || this.dateFilter === 'anio') {
      this.loadData();
    }
  }

onPersonalizadoChange(): void {
  if (this.dateFilter !== 'personalizado') return;
  if (!this.fechaDesde || !this.fechaHasta) return;

  // Normalizar: si la fecha derecha es menor que la izquierda, intercambiamos.
  if (this.fechaHasta < this.fechaDesde) {
    const tmp = this.fechaDesde;
    this.fechaDesde = this.fechaHasta;
    this.fechaHasta = tmp;
  }

  this.loadData();
}

  onSearch(): void {
    this.applyFilters();
  }

  onSort(campo: OrdenCampo): void {
    if (this.ordenCampo === campo) {
      this.ordenDir = this.ordenDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.ordenCampo = campo;
      this.ordenDir = 'desc';
    }
    this.applyFilters();
  }

  resetFilters(): void {
    const hoy = new Date();
    this.dateFilter = 'mes';
    this.selectedDate = this.formatDateForBackend(hoy);
    this.categoriaIngreso = null;
    this.categoriaGasto = null;
    this.searchTerm = '';
    this.ordenCampo = 'fecha';
    this.ordenDir = 'desc';
    this.openDropdown = null;
    this.loadData();
  }

  // ===== Navegación / sesión =====

  onLogout(): void {
    this.authService.logout();
  }

  onAcceptSessionExpired(): void {
    this.showSessionExpired = false;
    this.authService.confirmSessionExpired();
  }

  onNavClick(item: string): void {
    if (item !== 'Home' && item !== 'Gastos' && item !== 'Ingresos' && item !== 'Deudas' && item !== 'Resumen') return;

    if (item === 'Home') {
      this.router.navigate(['/app']);
      return;
    }
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
      return;
    }
  }

  // ===== Formatos =====

  formatCurrency(value: number): string {
    const num = typeof value === 'number' ? value : parseFloat(String(value)) || 0;
    return 'Q' + num.toFixed(2);
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
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  }

  trackByMovementId(_: number, m: SummaryMovement): number {
    return m.id + (m.tipo === 'ingreso' ? 1_000_000 : 0);
  }
  get rangoInvertido(): boolean {
  return this.dateFilter === 'personalizado'
    && !!this.fechaDesde
    && !!this.fechaHasta
    && this.fechaHasta < this.fechaDesde;
}
}