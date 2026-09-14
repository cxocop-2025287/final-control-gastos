import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Debt, DebtCreate, DebtPaymentCreate, DebtProgress } from '../models/debt.model';

@Injectable({
  providedIn: 'root',
})
export class DebtService {
  private readonly API_URL = '/api/debts';

  constructor(private http: HttpClient) {}

  getAll(archivadas = false): Observable<Debt[]> {
    const params = new HttpParams().set('archivadas', archivadas ? 'true' : 'false');
    return this.http.get<Debt[]>(this.API_URL, { params });
  }

  getProgress(): Observable<DebtProgress> {
    return this.http.get<DebtProgress>(`${this.API_URL}/progress`);
  }

  getById(id: number): Observable<Debt> {
    return this.http.get<Debt>(`${this.API_URL}/${id}`);
  }

  create(data: DebtCreate): Observable<Debt> {
    return this.http.post<Debt>(this.API_URL, data);
  }

  update(id: number, data: Partial<DebtCreate>): Observable<Debt> {
    return this.http.put<Debt>(`${this.API_URL}/${id}`, data);
  }

  delete(id: number): Observable<{ message: string; archived: boolean }> {
    return this.http.delete<{ message: string; archived: boolean }>(`${this.API_URL}/${id}`);
  }

  registerPayment(
    id: number,
    data: DebtPaymentCreate
  ): Observable<{ payment: any; deuda: Debt }> {
    return this.http.post<{ payment: any; deuda: Debt }>(`${this.API_URL}/${id}/payments`, data);
  }

  updatePayment(
    debtId: number,
    paymentId: number,
    data: { monto: number; fecha: string }
  ): Observable<{ payment: any; deuda: Debt | null }> {
    return this.http.put<{ payment: any; deuda: Debt | null }>(
      `${this.API_URL}/${debtId}/payments/${paymentId}`,
      data
    );
  }

  deletePayment(
    debtId: number,
    paymentId: number
  ): Observable<{ message: string; deuda: Debt | null }> {
    return this.http.delete<{ message: string; deuda: Debt | null }>(
      `${this.API_URL}/${debtId}/payments/${paymentId}`
    );
  }
}