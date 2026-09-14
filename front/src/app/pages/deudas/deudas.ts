import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription, finalize } from 'rxjs';
import { AuthService, User } from '../../services/auth.service';
import { DebtService } from '../../services/debt.service';
import { ExpenseService } from '../../services/expense.service';
import { Debt, DebtCreate, INTEREST_PERIODS, PERIOD_LABELS, STATUS_LABELS } from '../../models/debt.model';

@Component({
  selector: 'app-deudas',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './deudas.html',
  styleUrls: ['./deudas.css'],
})
export class DeudasComponent implements OnInit, OnDestroy {
  user: User | null = null;
  activeNav = 'Deudas';
  showSessionExpired = false;

  loading = true;
  loadError = '';
  saving = false;
  formError = '';

  debts: Debt[] = [];
  filteredDebts: Debt[] = [];

  statusFilter: '' | 'activa' | 'capital_pagado' | 'pagada' = '';
  searchTerm = '';

  totalPendiente = 0;
  totalPagado = 0;
  totalIntereses = 0;
  cantidadDeudas = 0;
  saldoDisponible = 0;

  interestPeriods = INTEREST_PERIODS;

  expandedDebtId: number | null = null;

  // ---- Modal crear / editar deuda ----
  showModal = false;
  editingId: number | null = null;
  editingDebt: Debt | null = null;
  formName = '';
  formCreditor = '';
  formOriginal: number | null = null;
  formStartDate: string = '';
  formInterestEnabled = false;
  formInterestRate: number | null = null;
  formInterestPeriod = 'monthly';

  // ---- Modal registrar pago ----
  showPaymentModal = false;
  paymentDebt: Debt | null = null;
  payMonto: number | null = null;
  payFecha: string = '';
  payError = '';

  // ---- Modal editar pago ----
  showEditPaymentModal = false;
  editingPaymentDebt: Debt | null = null;
  editingPayment: any = null;
  editPayMonto: number | null = null;
  editPayFecha: string = '';
  editPayError = '';

  // ---- Modal eliminar ----
  showDeleteModal = false;
  deleteTarget: Debt | null = null;
  deleteError = '';

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
    private debtService: DebtService,
    private expenseService: ExpenseService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit(): Promise<void> {
    this.user = this.authService.getUser();
    const hoy = new Date();
    this.payFecha = this.formatDateForBackend(hoy);
    this.formStartDate = this.payFecha;

    await this.authService.reloadConfig();

    this.sessionSub = this.authService.sessionExpired$.subscribe(() => {
      this.showSessionExpired = true;
      this.cdr.detectChanges();
    });

    this.refreshBalance();
    this.loadData();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
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

    this.subscriptions.push(
      this.debtService
        .getAll(false)
        .pipe(
          finalize(() => {
            this.loading = false;
            this.cdr.detectChanges();
          })
        )
        .subscribe({
          next: (debts) => {
            this.debts = debts;
            this.applyFilters();
            this.calcularTotales(this.debts);
          },
          error: (err) => {
            console.error('Error al cargar deudas:', err);
            this.loadError = err.error?.message || 'Error al cargar las deudas.';
            this.debts = [];
            this.applyFilters();
            this.calcularTotales([]);
          },
        })
    );
  }

  applyFilters(): void {
    let filtered = [...this.debts];
    if (this.statusFilter) {
      filtered = filtered.filter((d) => d.status === this.statusFilter);
    }
    if (this.searchTerm.trim()) {
      const term = this.searchTerm.trim().toLowerCase();
      filtered = filtered.filter(
        (d) =>
          d.name.toLowerCase().includes(term) ||
          d.creditor.toLowerCase().includes(term)
      );
    }
    this.filteredDebts = filtered;
  }

  calcularTotales(all: Debt[]): void {
    this.totalPendiente = all.reduce((sum, d) => sum + this.num(d.total_pending), 0);
    this.totalPagado = all.reduce((sum, d) => sum + this.num(d.total_paid), 0);
    this.totalIntereses = all.reduce((sum, d) => sum + this.num(d.interest_generated), 0);
    this.cantidadDeudas = all.length;
  }

  private num(value: number): number {
    return typeof value === 'number' ? value : parseFloat(String(value)) || 0;
  }

  private refreshBalance(): void {
    this.subscriptions.push(
      this.expenseService.getBalance().subscribe({
        next: (data) => {
          this.saldoDisponible = typeof data.balance === 'number' ? data.balance : parseFloat(String(data.balance)) || 0;
          this.cdr.detectChanges();
        },
        error: () => {
          this.saldoDisponible = 0;
        },
      })
    );
  }

  // ================== MODAL CREAR / EDITAR DEUDA ==================

  openCreate(): void {
    this.editingId = null;
    this.editingDebt = null;
    const hoy = new Date();
    this.formStartDate = this.formatDateForBackend(hoy);
    this.formName = '';
    this.formCreditor = '';
    this.formOriginal = null;
    this.formInterestEnabled = false;
    this.formInterestRate = null;
    this.formInterestPeriod = 'monthly';
    this.formError = '';
    this.showModal = true;
  }

  openEdit(debt: Debt): void {
    this.editingId = debt.id;
    this.editingDebt = debt;
    this.formName = debt.name;
    this.formCreditor = debt.creditor;
    this.formOriginal = this.num(debt.original_amount);
    this.formStartDate = debt.start_date;
    this.formInterestEnabled = !!debt.interest_enabled;
    this.formInterestRate = debt.interest_enabled ? this.num(debt.interest_rate) : null;
    this.formInterestPeriod = debt.interest_period;
    this.formError = '';
    this.showModal = true;
  }

  onCancel(): void {
    if (this.saving) return;
    this.showModal = false;
    this.editingId = null;
    this.editingDebt = null;
  }

  onInterestToggle(): void {
    if (this.formInterestEnabled && this.formInterestRate === null) {
      this.formInterestRate = 0;
    }
  }

  onSave(): void {
    if (!this.formName.trim()) {
      this.formError = 'El nombre de la deuda es obligatorio.';
      return;
    }
    if (!this.formCreditor.trim()) {
      this.formError = 'El acreedor es obligatorio.';
      return;
    }
    if (!this.formOriginal || this.formOriginal <= 0) {
      this.formError = 'El monto original debe ser mayor a 0.';
      return;
    }
    if (this.formInterestEnabled) {
      if (this.formInterestRate === null || this.formInterestRate < 0) {
        this.formError = 'El porcentaje de interés debe ser mayor o igual a 0.';
        return;
      }
    }
    if (!this.formStartDate) {
      this.formError = 'La fecha de inicio es obligatoria.';
      return;
    }
    if (this.formStartDate > this.hoy) {
      this.formError = 'La fecha de inicio no puede ser futura.';
      return;
    }

    this.saving = true;
    this.formError = '';

    const data: DebtCreate = {
      name: this.formName.trim(),
      creditor: this.formCreditor.trim(),
      original_amount: this.formOriginal,
      interest_enabled: this.formInterestEnabled,
      interest_rate: this.formInterestEnabled ? (this.formInterestRate ?? 0) : 0,
      interest_period: this.formInterestEnabled
        ? (this.formInterestPeriod as 'daily' | 'biweekly' | 'monthly')
        : 'monthly',
      start_date: this.formStartDate,
    };

    let request;
    if (this.editingId !== null) {
      request = this.debtService.update(this.editingId, data);
    } else {
      request = this.debtService.create(data);
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
          this.editingDebt = null;
          this.loadData();
        },
        error: (err) => {
          console.error('Error al guardar deuda:', err);
          this.formError = err.error?.message || 'Error al guardar. Intente nuevamente.';
        },
      });
  }

  // ================== MODAL REGISTRAR PAGO ==================

  openPayment(debt: Debt): void {
    this.paymentDebt = debt;
    this.payMonto = null;
    const hoy = new Date();
    this.payFecha = this.formatDateForBackend(hoy);
    this.payError = '';
    this.showPaymentModal = true;
  }

  closePaymentModal(): void {
    if (this.saving) return;
    this.showPaymentModal = false;
    this.paymentDebt = null;
    this.payMonto = null;
    this.payError = '';
  }

  onSubmitPayment(): void {
    if (!this.paymentDebt) return;
    if (!this.payMonto || this.payMonto <= 0) {
      this.payError = 'El monto del pago debe ser mayor a 0.';
      return;
    }
    if (!this.payFecha) {
      this.payError = 'La fecha del pago es obligatoria.';
      return;
    }
    if (this.payFecha < this.paymentDebt.start_date) {
      this.payError = 'La fecha del pago no puede ser anterior al inicio de la deuda.';
      return;
    }
    if (this.payFecha > this.hoy) {
      this.payError = 'La fecha del pago no puede ser futura.';
      return;
    }

    this.saving = true;
    this.payError = '';

    this.debtService
      .registerPayment(this.paymentDebt.id, { monto: this.payMonto, fecha: this.payFecha })
      .pipe(
        finalize(() => {
          this.saving = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: () => {
          this.showPaymentModal = false;
          this.paymentDebt = null;
          this.refreshBalance();
          this.loadData();
        },
        error: (err) => {
          console.error('Error al registrar pago:', err);
          this.payError = err.error?.message || 'Error al registrar el pago.';
        },
      });
  }

  // ================== MODAL EDITAR PAGO ==================

  openEditPayment(debt: Debt, payment: any): void {
    this.editingPaymentDebt = debt;
    this.editingPayment = payment;
    this.editPayMonto = this.num(payment.amount);
    this.editPayFecha = String(payment.fecha).split('T')[0];
    this.editPayError = '';
    this.showEditPaymentModal = true;
  }

  closeEditPaymentModal(): void {
    if (this.saving) return;
    this.showEditPaymentModal = false;
    this.editingPaymentDebt = null;
    this.editingPayment = null;
    this.editPayMonto = null;
    this.editPayFecha = '';
    this.editPayError = '';
  }

  onSubmitEditPayment(): void {
    if (!this.editingPaymentDebt || !this.editingPayment) return;
    if (!this.editPayMonto || this.editPayMonto <= 0) {
      this.editPayError = 'El monto debe ser mayor a 0.';
      return;
    }
    if (!this.editPayFecha) {
      this.editPayError = 'La fecha es obligatoria.';
      return;
    }
    if (this.editPayFecha < this.editingPaymentDebt.start_date) {
      this.editPayError = 'La fecha no puede ser anterior al inicio de la deuda.';
      return;
    }
    if (this.editPayFecha > this.hoy) {
      this.editPayError = 'La fecha no puede ser futura.';
      return;
    }

    this.saving = true;
    this.editPayError = '';

    this.debtService
      .updatePayment(this.editingPaymentDebt.id, this.editingPayment.id, {
        monto: this.editPayMonto,
        fecha: this.editPayFecha,
      })
      .pipe(
        finalize(() => {
          this.saving = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: () => {
          this.showEditPaymentModal = false;
          this.editingPaymentDebt = null;
          this.editingPayment = null;
          this.refreshBalance();
          this.loadData();
        },
        error: (err) => {
          console.error('Error al actualizar pago:', err);
          this.editPayError = err.error?.message || 'Error al actualizar el pago.';
        },
      });
  }

  togglePayments(debt: Debt): void {
    if (!debt.payments || debt.payments.length === 0) return;
    this.expandedDebtId = this.expandedDebtId === debt.id ? null : debt.id;
  }

  onDeletePayment(debt: Debt, payment: any): void {
    if (!confirm(`¿Eliminar el pago del ${this.formatDate(payment.fecha)} por ${this.formatCurrency(payment.amount)}? Se borrará también el gasto asociado.`)) {
      return;
    }

    this.debtService.deletePayment(debt.id, payment.id).subscribe({
      next: () => {
        this.refreshBalance();
        this.loadData();
      },
      error: (err) => {
        console.error('Error al eliminar pago:', err);
        alert(err.error?.message || 'Error al eliminar el pago.');
      },
    });
  }

  // ================== ELIMINAR DEUDA ==================

  requestDelete(debt: Debt): void {
    this.deleteTarget = debt;
    this.deleteError = '';
    this.showDeleteModal = true;
  }

  onCancelDelete(): void {
    if (this.saving) return;
    this.showDeleteModal = false;
    this.deleteTarget = null;
  }

  confirmDelete(): void {
    if (!this.deleteTarget) return;
    this.saving = true;
    this.deleteError = '';

    this.debtService
      .delete(this.deleteTarget.id)
      .pipe(
        finalize(() => {
          this.saving = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: () => {
          this.showDeleteModal = false;
          this.deleteTarget = null;
          this.refreshBalance();
          this.loadData();
        },
        error: (err) => {
          console.error('Error al eliminar deuda:', err);
          this.deleteError = err.error?.message || 'Error al eliminar la deuda.';
        },
      });
  }

  // ================== FILTROS ==================

  onFilterStatus(status: '' | 'activa' | 'capital_pagado' | 'pagada'): void {
    this.statusFilter = status;
    this.applyFilters();
  }

  onSearch(): void {
    this.applyFilters();
  }

  // ================== NAVEGACIÓN ==================

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
  if (item === 'Resumen') {
    this.router.navigate(['/resumen']);
    return;
  }
  if (item === 'Deudas') {
    return; // ya estamos aquí
  }
}
  // ================== FORMATOS ==================

  formatCurrency(value: number): string {
    const num = this.num(value);
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

  periodLabel(period: string): string {
    return PERIOD_LABELS[period] || period;
  }

  statusLabel(status: string): string {
    return STATUS_LABELS[status] || status;
  }

  interestInfo(debt: Debt): string {
    if (!debt.interest_enabled) return 'Sin intereses';
    return `${debt.interest_rate}% ${this.periodLabel(debt.interest_period).toLowerCase()} (simple)`;
  }

  elapsedLabel(debt: Debt): string {
    const periods = this.num(debt.periodos_transcurridos);
    const p = debt.interest_period;
    if (p === 'daily') return `${periods} día${periods === 1 ? '' : 's'}`;
    if (p === 'biweekly') return `${periods} quincena${periods === 1 ? '' : 's'}`;
    return `${periods} mes${periods === 1 ? '' : 'es'}`;
  }

  progressWidth(debt: Debt): string {
    const p = this.num(debt.percentage);
    return Math.max(0, Math.min(100, p)) + '%';
  }
}