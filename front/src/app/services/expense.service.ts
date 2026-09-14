import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Expense, ExpenseCreate, ExpenseSummary, EXPENSE_CATEGORIES } from '../models/expense.model';

@Injectable({
  providedIn: 'root',
})
export class ExpenseService {
  private readonly API_URL = '/api/expenses';

  constructor(private http: HttpClient) {}

  getAll(filters?: { fechaDesde?: string; fechaHasta?: string; categoria?: string }): Observable<Expense[]> {
    let params = new HttpParams();
    if (filters?.fechaDesde) params = params.set('fechaDesde', filters.fechaDesde);
    if (filters?.fechaHasta) params = params.set('fechaHasta', filters.fechaHasta);
    if (filters?.categoria) params = params.set('categoria', filters.categoria);

    return this.http.get<Expense[]>(this.API_URL, { params });
  }

  getSummary(fechaDesde: string, fechaHasta: string): Observable<ExpenseSummary> {
    const params = new HttpParams()
      .set('fechaDesde', fechaDesde)
      .set('fechaHasta', fechaHasta);

    return this.http.get<ExpenseSummary>(`${this.API_URL}/summary`, { params });
  }

  getBalance(): Observable<{ balance: number }> {
    return this.http.get<{ balance: number }>(`${this.API_URL}/balance`);
  }

  getCategories(): Observable<string[]> {
    return this.http.get<string[]>(`${this.API_URL}/categories`);
  }

  create(data: ExpenseCreate): Observable<Expense> {
    return this.http.post<Expense>(this.API_URL, data);
  }

  update(id: number, data: Partial<ExpenseCreate>): Observable<Expense> {
    return this.http.put<Expense>(`${this.API_URL}/${id}`, data);
  }

  delete(id: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.API_URL}/${id}`);
  }

  getCategoriesList(): string[] {
    return [...EXPENSE_CATEGORIES];
  }
}