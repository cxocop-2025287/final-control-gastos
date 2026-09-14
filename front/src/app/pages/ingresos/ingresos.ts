import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription, finalize } from 'rxjs';
import { AuthService, User } from '../../services/auth.service';
import { IncomeService } from '../../services/income.service';
import { Income, IncomeCreate, INCOME_CATEGORIES } from '../../models/income.model';

type DateFilterMode = 'dia' | 'mes' | 'anio' | 'todo';

@Component({
  selector: 'app-ingresos',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ingresos.html',
  styleUrls: ['./ingresos.css'],
})
export class IngresosComponent implements OnInit, OnDestroy {
  user: User | null = null;
  activeNav = 'Ingresos';
  showSessionExpired = false;

  loading = true;
  loadError = '';
  saving = false;
  formError = '';

  ingresos: Income[] = [];
  filteredIngresos: Income[] = [];
  totalMes = 0;
  cantidadIngresos = 0;

  dateFilter: DateFilterMode = 'mes';
  selectedDate: string = '';
  searchTerm = '';
  selectedCategoria: string | null = null;

  categoriasFiltro: string[] = [];

  showModal = false;
  editingId: number | null = null;

  formFecha: string = '';
  formDescripcion = '';
  formCategoria = '';
  formMonto: number | null = null;

  incomeCategories = INCOME_CATEGORIES;
  /** Fecha máxima permitida en los calendarios (hoy, no se permite futuro) */
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
    private incomeService: IncomeService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit(): Promise<void> {
    this.user = this.authService.getUser();
    this.categoriasFiltro = this.incomeService.getCategoriesList();
    
    const hoy = new Date();
    this.selectedDate = this.formatDateForBackend(hoy);
    this.formFecha = this.selectedDate;
    
    await this.authService.reloadConfig();
    
    this.sessionSub = this.authService.sessionExpired$.subscribe(() => {
      this.showSessionExpired = true;
      this.cdr.detectChanges();
    });
    
    this.loadData();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.sessionSub?.unsubscribe();
  }

  private formatDateForBackend(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  loadData(): void {
    this.loading = true;
    this.loadError = '';

    const { desde, hasta } = this.getDateRange();

    console.log(`📅 Ingresos - Consultando desde ${desde} hasta ${hasta}`);

    this.incomeService
      .getAll({ fechaDesde: desde, fechaHasta: hasta })
      .pipe(finalize(() => {
        this.loading = false;
        this.cdr.detectChanges();
      }))
      .subscribe({
        next: (data) => {
          this.ingresos = data.map(inc => ({
            ...inc,
            monto: typeof inc.monto === 'number' ? inc.monto : parseFloat(String(inc.monto)) || 0
          }));
          this.applyFilters();
          this.calcularTotales();
        },
        error: (err) => {
          console.error('Error al cargar ingresos:', err);
          this.loadError = 'Error al cargar los datos. Intente nuevamente.';
          this.ingresos = [];
          this.filteredIngresos = [];
          this.totalMes = 0;
          this.cantidadIngresos = 0;
        },
      });
  }

  /**
   * Parsea una fecha "YYYY-MM-DD" como fecha LOCAL (no UTC).
   */
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

  private getDateRange(): { desde: string; hasta: string } {
    const date = this.parseDateLocal(this.selectedDate);
    let desde = new Date(date);
    let hasta = new Date(date);

    switch (this.dateFilter) {
      case 'dia':
        desde = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        hasta = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        break;
      case 'mes':
        desde = new Date(date.getFullYear(), date.getMonth(), 1);
        hasta = new Date(date.getFullYear(), date.getMonth() + 1, 0);
        break;
      case 'anio':
        desde = new Date(date.getFullYear(), 0, 1);
        hasta = new Date(date.getFullYear(), 11, 31);
        break;
      case 'todo':
        desde = new Date(2000, 0, 1);
        hasta = new Date(2100, 11, 31);
        break;
      default:
        const hoy = new Date();
        desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
        hasta = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
        break;
    }

    return {
      desde: this.formatDateForBackend(desde),
      hasta: this.formatDateForBackend(hasta),
    };
  }

  applyFilters(): void {
    let filtered = [...this.ingresos];

    if (this.selectedCategoria) {
      filtered = filtered.filter(inc => inc.categoria === this.selectedCategoria);
    }

    if (this.searchTerm.trim()) {
      const term = this.searchTerm.trim().toLowerCase();
      filtered = filtered.filter(
        inc =>
          inc.descripcion.toLowerCase().includes(term) ||
          inc.categoria.toLowerCase().includes(term)
      );
    }

    this.filteredIngresos = filtered;
  }

  calcularTotales(): void {
    this.totalMes = this.filteredIngresos.reduce((sum, inc) => {
      const monto = typeof inc.monto === 'number' ? inc.monto : parseFloat(String(inc.monto)) || 0;
      return sum + monto;
    }, 0);
    this.cantidadIngresos = this.filteredIngresos.length;
  }

  onFilterChange(mode: DateFilterMode): void {
    this.dateFilter = mode;
    this.loadData();
  }

  onDateChange(): void {
    this.loadData();
  }

  onSearch(): void {
    this.applyFilters();
    this.calcularTotales();
  }

  onCategoriaClick(cat: string | null): void {
    this.selectedCategoria = cat;
    this.applyFilters();
    this.calcularTotales();
  }

  openCreate(): void {
    this.editingId = null;
    const hoy = new Date();
    this.formFecha = this.formatDateForBackend(hoy);
    this.formDescripcion = '';
    this.formCategoria = this.incomeCategories[0];
    this.formMonto = null;
    this.formError = '';
    this.showModal = true;
  }

  openEdit(income: Income): void {
    this.editingId = income.id;
    this.formFecha = income.fecha;
    this.formDescripcion = income.descripcion;
    this.formCategoria = income.categoria;
    this.formMonto = income.monto;
    this.formError = '';
    this.showModal = true;
  }

  onCancel(): void {
    if (this.saving) return;
    this.showModal = false;
    this.editingId = null;
  }

  onSave(): void {
    if (!this.formDescripcion.trim()) {
      this.formError = 'La descripción es obligatoria.';
      return;
    }
    if (!this.formCategoria) {
      this.formError = 'Seleccione una categoría.';
      return;
    }
    if (!this.formMonto || this.formMonto <= 0) {
      this.formError = 'El monto debe ser mayor a 0.';
      return;
    }

    this.saving = true;
    this.formError = '';

    const data: IncomeCreate = {
      fecha: this.formFecha,
      descripcion: this.formDescripcion.trim(),
      categoria: this.formCategoria,
      monto: this.formMonto,
    };

    let request;
    if (this.editingId !== null) {
      request = this.incomeService.update(this.editingId, data);
    } else {
      request = this.incomeService.create(data);
    }

    request
      .pipe(finalize(() => {
        this.saving = false;
        this.cdr.detectChanges();
      }))
      .subscribe({
        next: () => {
          this.showModal = false;
          this.editingId = null;
          this.loadData();
        },
        error: (err) => {
          console.error('Error al guardar:', err);
          this.formError = err.error?.message || 'Error al guardar. Intente nuevamente.';
        },
      });
  }

  onDelete(income: Income): void {
    if (!confirm(`¿Eliminar el ingreso "${income.descripcion}"?`)) return;

    this.incomeService.delete(income.id).subscribe({
      next: () => {
        this.loadData();
      },
      error: (err) => {
        console.error('Error al eliminar:', err);
        this.loadError = err.error?.message || 'Error al eliminar el ingreso.';
      },
    });
  }

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
  if (item === 'Deudas') {
    this.router.navigate(['/deudas']);
    return;
  }
  if (item === 'Resumen') {
    this.router.navigate(['/resumen']);
    return;
  }
  if (item === 'Ingresos') {
    return; // ya estamos aquí
  }
}
  formatCurrency(value: number): string {
    const num = typeof value === 'number' ? value : parseFloat(String(value)) || 0;
    return 'Q' + num.toFixed(2);
  }

  formatDate(dateStr: string): string {
    if (!dateStr) return 'Fecha no disponible';
    try {
      // Parsear como fecha local para evitar desfase UTC
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
}