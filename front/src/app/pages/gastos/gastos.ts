import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription, finalize, forkJoin, of, catchError } from 'rxjs';
import { AuthService, User } from '../../services/auth.service';
import { ExpenseService } from '../../services/expense.service';
import { Expense, ExpenseCreate, EXPENSE_CATEGORIES } from '../../models/expense.model';

type DateFilterMode = 'dia' | 'mes' | 'anio' | 'todo';

@Component({
  selector: 'app-gastos',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './gastos.html',
  styleUrls: ['./gastos.css'],
})
export class GastosComponent implements OnInit, OnDestroy {
  user: User | null = null;
  activeNav = 'Gastos';
  showSessionExpired = false;

  loading = true;
  loadError = '';
  saving = false;
  formError = '';

  gastos: Expense[] = [];
  filteredGastos: Expense[] = [];
  totalMes = 0;
  cantidadGastos = 0;
  saldoDisponible = 0;

  dateFilter: DateFilterMode = 'mes';
  selectedDate: string = '';
  searchTerm = '';
  selectedCategoria: string | null = null;

  categoriasFiltro: string[] = [];

  /** Categorías disponibles en el modal de crear/editar gasto.
   *  NO incluye 'Deudas': esos gastos se crean desde el módulo de Deudas. */
  categoriasFormulario: string[] = [];

  showModal = false;
  editingId: number | null = null;

  formFecha: string = '';
  formDescripcion = '';
  formCategoria = '';
  formMonto: number | null = null;
  formMontoOriginal = 0;

  expenseCategories = EXPENSE_CATEGORIES;

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
    private expenseService: ExpenseService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit(): Promise<void> {
    this.user = this.authService.getUser();
    this.categoriasFiltro = this.expenseService.getCategoriesList();

    // El modal solo permite categorías normales. 'Deudas' queda reservada
    // para el módulo de Deudas (registro de pagos).
    this.categoriasFormulario = this.expenseService
      .getCategoriesList()
      .filter((c) => c !== 'Deudas');

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

    this.subscriptions.push(
      forkJoin({
        balance: this.expenseService
          .getBalance()
          .pipe(catchError(() => of({ balance: 0 }))),
        gastos: this.expenseService.getAll({ fechaDesde: desde, fechaHasta: hasta }),
      })
        .pipe(
          finalize(() => {
            this.loading = false;
            this.cdr.detectChanges();
          })
        )
        .subscribe({
          next: ({ balance, gastos }) => {
            this.saldoDisponible =
              typeof balance.balance === 'number'
                ? balance.balance
                : parseFloat(String(balance.balance)) || 0;

            this.gastos = gastos.map(g => ({
              ...g,
              monto: typeof g.monto === 'number' ? g.monto : parseFloat(String(g.monto)) || 0,
            }));

            this.applyFilters();
            this.calcularTotales();
            this.cdr.detectChanges();
          },
          error: (err) => {
            console.error('Error al cargar gastos:', err);
            this.loadError = 'Error al cargar los datos. Intente nuevamente.';
            this.gastos = [];
            this.filteredGastos = [];
            this.totalMes = 0;
            this.cantidadGastos = 0;
            this.cdr.detectChanges();
          },
        })
    );
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
    let filtered = [...this.gastos];

    if (this.selectedCategoria) {
      filtered = filtered.filter(g => g.categoria === this.selectedCategoria);
    }

    if (this.searchTerm.trim()) {
      const term = this.searchTerm.trim().toLowerCase();
      filtered = filtered.filter(
        g =>
          g.descripcion.toLowerCase().includes(term) ||
          g.categoria.toLowerCase().includes(term)
      );
    }

    this.filteredGastos = filtered;
  }

  calcularTotales(): void {
    this.totalMes = this.filteredGastos.reduce((sum, g) => {
      const monto = typeof g.monto === 'number' ? g.monto : parseFloat(String(g.monto)) || 0;
      return sum + monto;
    }, 0);
    this.cantidadGastos = this.filteredGastos.length;
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
    this.formCategoria = this.categoriasFormulario[0];
    this.formMonto = null;
    this.formMontoOriginal = 0;
    this.formError = '';
    this.showModal = true;
  }

  openEdit(expense: Expense): void {
    if (expense.debt_id) {
      const ir = confirm(
        'Este gasto corresponde a un pago de deuda. Solo puede modificarse desde el módulo de Deudas.\n\n¿Desea ir al módulo de Deudas?'
      );
      if (ir) {
        this.router.navigate(['/deudas']);
      }
      return;
    }

    this.editingId = expense.id;
    this.formFecha = expense.fecha;
    this.formDescripcion = expense.descripcion;
    this.formCategoria = expense.categoria;
    this.formMonto = expense.monto;
    this.formMontoOriginal = expense.monto;
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
    if (this.formCategoria === 'Deudas') {
      this.formError = 'La categoría Deudas solo se gestiona desde el módulo de Deudas.';
      return;
    }
    if (!this.formMonto || this.formMonto <= 0) {
      this.formError = 'El monto debe ser mayor a 0.';
      return;
    }
    if (this.formMonto > this.saldoDisponible + (this.editingId !== null ? this.formMontoOriginal : 0)) {
      this.formError = `Saldo insuficiente. Solo puede gastar ${this.formatCurrency(this.saldoDisponible)} de su dinero total.`;
      return;
    }

    this.saving = true;
    this.formError = '';

    const data: ExpenseCreate = {
      fecha: this.formFecha,
      descripcion: this.formDescripcion.trim(),
      categoria: this.formCategoria,
      monto: this.formMonto,
    };

    let request;
    if (this.editingId !== null) {
      request = this.expenseService.update(this.editingId, data);
    } else {
      request = this.expenseService.create(data);
    }

    request
      .pipe(
        finalize(() => {
          this.saving = false;
          this.cdr.detectChanges();
        })
      )
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

  onDelete(expense: Expense): void {
    if (!confirm(`¿Eliminar el gasto "${expense.descripcion}"?`)) return;

    this.expenseService.delete(expense.id).subscribe({
      next: () => {
        this.loadData();
      },
      error: (err) => {
        console.error('Error al eliminar:', err);
        this.loadError = 'Error al eliminar el gasto.';
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
  if (item === 'Gastos') {
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
}