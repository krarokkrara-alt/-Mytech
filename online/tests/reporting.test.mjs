import test from 'node:test';
import assert from 'node:assert/strict';
import {financialReport} from '../my-tech-accounting/reporting.mjs';

function fixture() {
  return {accounts: [{id: 'biz', name: 'Business cash', scope: 'business'}, {id: 'personal', name: 'Owner cash', scope: 'personal'}],
    entries: [], documents: [], customers: [], enrollments: [], courses: [], purchases: [], products: [], movements: [], payroll: [], bills: []};
}

const entry = (id, type, amount, cash, extra = {}) => ({id, type, amount, cash, accountId: 'biz', date: '2026-11-10', project: '', note: id, ...extra});
const byKey = (rows, key) => rows.find(row => row.key === key).amount;

test('reports include interest and paid salary in expenses while keeping every cash-out type distinct and personal money separate', () => {
  const s = fixture();
  s.entries = [entry('opening', 'opening', 100000, 100000), entry('income', 'income', 20000, 20000),
    entry('ordinary', 'expense', 2500, -2500), entry('settled', 'settlement', 1000, 0), entry('interest', 'interest', 125, -125),
    entry('salary', 'expense', 5000, -5000, {payrollId: 'slip'}), entry('advance', 'advance', 2000, -2000),
    entry('principal', 'debt_repay', 500, -500), entry('withdrawal', 'owner_out', 300, -300),
    entry('capital', 'owner_in', 1000, 1000), entry('advance-return', 'advance_return', 100, 100),
    entry('personal-expense', 'expense', 700, -700, {accountId: 'personal'}), entry('personal-interest', 'interest', 50, -50, {accountId: 'personal'}),
    entry('wrong-expense', 'expense', 900, -900), entry('reversal', 'reversal', 900, 900, {reverses: 'wrong-expense'})];
  const r = financialReport(s);
  assert.equal(r.business.income, 20000); assert.equal(r.business.expense, 8625);
  assert.equal(r.business.salaryPaid, 5000); assert.equal(r.business.interestPaid, 125);
  assert.equal(r.business.cashIn, 121100); assert.equal(r.business.cashOut, 10425);
  assert.equal(byKey(r.business.expenses, 'settlement'), 1000); assert.equal(byKey(r.business.outflows, 'advance'), 2000);
  assert.equal(byKey(r.business.outflows, 'debt_repay'), 500); assert.equal(byKey(r.business.outflows, 'owner_out'), 300);
  assert.equal(r.business.outflows.reduce((n, row) => n + row.amount, 0), r.business.cashOut);
  assert.equal(r.personal.expense, 750); assert.equal(r.personal.cashOut, 750);
  assert.ok(!r.entries.some(row => row.id === 'wrong-expense' || row.id === 'reversal'));
});

test('invoice rows use issue date and all current active payments without creating a second income', () => {
  const s = fixture();
  s.customers = [{id: 'customer', name: 'Customer'}]; s.courses = [{id: 'course', name: 'ECU course'}];
  s.enrollments = [{id: 'enrollment', customerId: 'customer', courseId: 'course', price: 30000}];
  s.documents = [
    {id: 'invoice', kind: 'invoice', number: 'INV-001', date: '2026-11-01', status: 'issued', total: 50000, customer: {name: 'Customer'}},
    {id: 'course-invoice', kind: 'invoice', number: 'INV-002', date: '2026-11-02', status: 'issued', total: 30000, customerId: 'customer', enrollmentId: 'enrollment'},
    {id: 'cancelled', kind: 'invoice', number: 'INV-003', date: '2026-11-03', status: 'cancelled', total: 9000},
    {id: 'quote', kind: 'quote', number: 'QT-001', date: '2026-11-03', status: 'issued', total: 99000}
  ];
  s.entries = [entry('receipt', 'income', 20000, 20000, {date: '2026-12-01', invoiceId: 'invoice'}),
    entry('old-course-deposit', 'income', 10000, 10000, {date: '2026-10-01', enrollmentId: 'enrollment'}),
    entry('course-receipt', 'income', 5000, 5000, {invoiceId: 'course-invoice', enrollmentId: 'enrollment'}),
    entry('cancelled-payment', 'income', 1000, 1000, {invoiceId: 'invoice'}), entry('undo', 'reversal', 1000, -1000, {reverses: 'cancelled-payment'})];
  const r = financialReport(s, {from: '2026-11-01', to: '2026-11-30'});
  assert.equal(r.business.income, 5000); assert.equal(r.invoices.total, 80000); assert.equal(r.invoices.paid, 35000); assert.equal(r.invoices.outstanding, 45000);
  assert.equal(r.invoices.count, 2); assert.equal(r.invoices.rowCount, 3); assert.equal(r.invoices.cancelledCount, 1);
  assert.equal(r.invoices.rows.find(row => row.id === 'invoice').paid, 20000);
  assert.equal(r.invoices.rows.find(row => row.id === 'course-invoice').paid, 15000);
  assert.equal(r.invoices.balanceBasis, 'current-active-payments-all-dates');
});

test('supplier bill and linked purchase count once, including purchase payments made before the bill existed', () => {
  const s = fixture();
  s.products = [{id: 'product', name: 'Parts', sku: 'PART-1', kind: 'material'}];
  s.purchases = [{id: 'purchase', productId: 'product', vendor: 'Supplier', total: 10000, date: '2026-11-01'},
    {id: 'unbilled-purchase', productId: 'product', vendor: 'Supplier 2', total: 8000, date: '2026-11-02'}];
  s.bills = [{id: 'bill', number: 'BILL-001', vendor: 'Supplier', total: 10000, date: '2026-11-03', status: 'issued', purchaseId: 'purchase'},
    {id: 'rent', number: 'BILL-002', vendor: 'Landlord', total: 5000, date: '2026-11-04', status: 'issued', category: 'Rent'},
    {id: 'void', number: 'BILL-003', total: 9000, date: '2026-11-05', status: 'cancelled'}];
  s.entries = [entry('before-bill', 'expense', 2000, -2000, {purchaseId: 'purchase', date: '2026-10-20'}),
    entry('after-bill', 'settlement', 3000, 0, {purchaseId: 'purchase', billId: 'bill'}),
    entry('po-only', 'expense', 1000, -1000, {purchaseId: 'unbilled-purchase'})];
  const r = financialReport(s, {from: '2026-11-01', to: '2026-11-30'});
  assert.equal(r.bills.total, 15000); assert.equal(r.bills.paid, 5000); assert.equal(r.bills.outstanding, 10000);
  assert.equal(r.bills.rows.find(row => row.id === 'bill').paid, 5000); // OR, never count the dual-linked payment twice.
  assert.equal(r.purchases.outstanding, 12000); assert.equal(r.purchases.unbilledOutstanding, 7000);
  assert.equal(r.purchases.rows.find(row => row.id === 'purchase').coveredByBills, true);
  assert.equal(r.payables.total, 17000); assert.equal(r.business.expense, 4000);
});

test('filtered bill/PO dates never make an obligation disappear or count it twice', () => {
  const s = fixture();
  s.purchases = [{id: 'purchase', vendor: 'Supplier', total: 10000, date: '2026-10-01'}];
  s.bills = [{id: 'bill', number: 'BILL-001', vendor: 'Supplier', total: 10000, date: '2026-11-01', status: 'issued', purchaseId: 'purchase'}];
  s.entries = [entry('payment', 'expense', 2000, -2000, {purchaseId: 'purchase', billId: 'bill'})];
  assert.equal(financialReport(s).payables.total, 8000);
  const october = financialReport(s, {from: '2026-10-01', to: '2026-10-31'});
  assert.equal(october.bills.count, 0); assert.equal(october.purchases.rows[0].coveredByBills, true); assert.equal(october.payables.total, 8000);
  assert.equal(financialReport(s, {from: '2026-11-01', to: '2026-11-30'}).payables.total, 8000);
});

test('payroll obligations use payroll month and current payment activity, including reversed and cancelled slips', () => {
  const s = fixture();
  const employee = {name: 'Employee', code: 'E1'};
  s.payroll = [
    {id: 'draft', month: '2026-11', employee, gross: 15000, totalDeductions: 2655, net: 12345, status: 'draft'},
    {id: 'paid', month: '2026-11', employee, gross: 5500, totalDeductions: 500, net: 5000, status: 'paid', paymentEntryId: 'salary-payment'},
    {id: 'reversed', month: '2026-11', employee, gross: 1000, totalDeductions: 100, net: 900, status: 'paid', paymentEntryId: 'old-salary-payment'},
    {id: 'cancelled', month: '2026-11', employee, gross: 200, totalDeductions: 0, net: 200, status: 'cancelled'},
    {id: 'december', month: '2026-12', employee, gross: 1000, totalDeductions: 0, net: 1000, status: 'draft'}
  ];
  s.entries = [entry('salary-payment', 'expense', 5000, -5000, {date: '2026-12-01', payrollId: 'paid', project: 'เงินเดือน'}),
    entry('old-salary-payment', 'expense', 900, -900, {payrollId: 'reversed', project: 'เงินเดือน'}),
    entry('undo-salary', 'reversal', 900, 900, {reverses: 'old-salary-payment'})];
  const r = financialReport(s, {from: '2026-11-10', to: '2026-11-20'});
  assert.equal(r.business.salaryPaid, 0); assert.equal(r.payroll.count, 3); assert.equal(r.payroll.rowCount, 4);
  assert.equal(r.payroll.gross, 21500); assert.equal(r.payroll.deductions, 3255); assert.equal(r.payroll.net, 18245);
  assert.equal(r.payroll.paid, 5000); assert.equal(r.payroll.unpaid, 13245);
  assert.equal(r.payroll.rows.find(row => row.id === 'reversed').paymentStatus, 'unpaid');
  assert.equal(r.obligations.payroll, 13245); assert.equal(r.payroll.dateBasis, 'payroll-month');
});

test('linked references resolve customer, Invoice, supplier bill and owner-visible employee searches', () => {
  const s = fixture();
  s.documents = [{id: 'invoice', kind: 'invoice', number: 'INV-SEARCH', customer: {name: 'Specific customer'}, total: 10000, date: '2026-11-10', status: 'issued'}];
  s.bills = [{id: 'bill', number: 'BILL-SEARCH', vendor: 'Specific supplier', total: 5000, date: '2026-11-10', status: 'issued'}];
  s.payroll = [{id: 'slip', employee: {name: 'Private employee', code: 'SECRET'}, month: '2026-11', gross: 1000, totalDeductions: 0, net: 1000, paymentEntryId: 'salary', status: 'paid'}];
  s.entries = [entry('receipt', 'income', 10000, 10000, {invoiceId: 'invoice'}), entry('vendor-payment', 'expense', 5000, -5000, {billId: 'bill'}), entry('salary', 'expense', 1000, -1000, {payrollId: 'slip'})];
  assert.equal(financialReport(s, {search: 'INV-SEARCH'}).business.income, 10000);
  assert.equal(financialReport(s, {search: 'Specific customer'}).business.income, 10000);
  assert.equal(financialReport(s, {search: 'BILL-SEARCH'}).business.expense, 5000);
  assert.equal(financialReport(s, {search: 'Specific supplier'}).business.expense, 5000);
  assert.equal(financialReport(s, {search: 'Private employee'}).business.salaryPaid, 1000);
  const publicState = {...s, payroll: [], entries: s.entries.filter(row => row.id !== 'salary').concat(entry('salary-summary-biz:2026-11-10', 'expense', 1000, -1000, {project: 'เงินเดือน', note: 'ค่าใช้จ่ายเงินเดือนรวม'}))};
  const publicReport = financialReport(publicState);
  assert.equal(publicReport.business.salaryPaid, 1000); assert.equal(publicReport.payroll.count, 0);
  assert.ok(!JSON.stringify(publicReport).includes('Private employee')); assert.ok(!JSON.stringify(publicReport).includes('SECRET'));
  assert.equal(financialReport(publicState, {search: 'Private employee'}).business.salaryPaid, 0);
});

test('material returns without a project inherit source issue attribution and tools do not become consumable cost', () => {
  const s = fixture();
  s.products = [{id: 'material', name: 'Parts', kind: 'material'}, {id: 'tool', name: 'Reusable tool', kind: 'tool'}];
  s.movements = [
    {id: 'issue', productId: 'material', type: 'issue', value: 10000, project: 'ECU course', date: '2026-10-10'},
    {id: 'return', productId: 'material', type: 'return', sourceId: 'issue', value: 2500, project: '', date: '2026-11-10'},
    {id: 'tool-issue', productId: 'tool', type: 'issue', value: 9000, project: 'ECU course', date: '2026-11-10'}
  ];
  assert.equal(financialReport(s).materials.total, 7500);
  const november = financialReport(s, {from: '2026-11-01', to: '2026-11-30', project: 'ECU course'});
  assert.equal(november.materials.total, -2500); assert.deepEqual(november.materials.rows, [{project: 'ECU course', cost: -2500}]);
});

test('reports do not mutate accounting state and identify the current-valid rather than as-of basis', () => {
  const s = fixture(); s.entries = [entry('income', 'income', 12345, 12345)];
  const before = JSON.stringify(s), r = financialReport(s);
  assert.equal(JSON.stringify(s), before); assert.equal(r.basis.kind, 'current-valid-not-as-of');
  assert.equal(r.basis.money, 'integer-satang'); assert.equal(financialReport(s, {search: '123.45'}).business.income, 12345);
});

test('business supplier and payroll obligations stay distinct from owner personal bills', () => {
  const s = fixture();
  s.purchases = [{id: 'purchase', total: 4000, date: '2026-11-01'}];
  s.bills = [
    {id: 'business-bill', scope: 'business', total: 10000, date: '2026-11-01', status: 'issued'},
    {id: 'personal-bill', scope: 'personal', total: 7000, date: '2026-11-01', status: 'issued'}
  ];
  s.payroll = [{id: 'salary', month: '2026-11', gross: 1000, totalDeductions: 100, net: 900, status: 'draft'}];
  s.entries = [entry('business-payment', 'expense', 1000, -1000, {billId: 'business-bill'}),
    entry('personal-payment', 'expense', 2000, -2000, {billId: 'personal-bill', accountId: 'personal'})];
  const r = financialReport(s);
  assert.equal(r.bills.business.outstanding, 9000); assert.equal(r.bills.personal.outstanding, 5000);
  assert.equal(r.payables.business.total, 13000); assert.equal(r.payables.personal.total, 5000);
  assert.equal(r.payables.business.totalWithPayroll, 13900); assert.equal(r.payables.personal.totalWithPayroll, 5000);
  assert.equal(r.payables.total, 18000); assert.equal(r.business.expense, 1000); assert.equal(r.personal.expense, 2000);
});

test('debt principal balances use current active repayments and never become operating expense', () => {
  const s = fixture();
  s.debts = [
    {id: 'business-debt', name: 'Business lender', amount: 10000, scope: 'business', createdAt: '2026-11-01T00:00:00Z'},
    {id: 'personal-debt', name: 'Personal lender', amount: 75000, scope: 'personal', createdAt: '2026-10-01T00:00:00Z', due: '2026-11-09'}
  ];
  s.entries = [entry('repayment', 'debt_repay', 2000, -2000, {debtId: 'business-debt', date: '2026-12-01'}),
    entry('old-repayment', 'debt_repay', 1000, -1000, {debtId: 'business-debt'}),
    entry('undo-repayment', 'reversal', 1000, 1000, {reverses: 'old-repayment'}),
    entry('personal-repayment', 'debt_repay', 5000, -5000, {debtId: 'personal-debt', accountId: 'personal'}),
    entry('interest', 'interest', 100, -100)];
  const r = financialReport(s);
  assert.equal(r.debts.principal, 85000); assert.equal(r.debts.repaid, 7000); assert.equal(r.debts.outstanding, 78000);
  assert.equal(r.debts.business.outstanding, 8000); assert.equal(r.debts.personal.outstanding, 70000);
  assert.equal(r.business.expense, 100); assert.equal(r.personal.expense, 0);
  const november = financialReport(s, {from: '2026-11-01', to: '2026-11-30'});
  assert.equal(november.debts.count, 1); assert.equal(november.debts.outstanding, 8000);
  assert.equal(november.debts.dateBasis, 'record-created-date');
  assert.equal(financialReport(s, {search: 'Personal lender'}).personal.cashOut, 5000);
  assert.equal(financialReport({...s, debts: [], entries: []}).debts.count, 0);
});

test('cancelled bills release purchase coverage and reversed payments restore the open balance', () => {
  const s = fixture();
  s.purchases = [{id: 'purchase', total: 10000, date: '2026-11-01'}];
  s.bills = [{id: 'cancelled-bill', purchaseId: 'purchase', total: 10000, status: 'cancelled', date: '2026-11-02'}];
  s.entries = [entry('payment', 'expense', 4000, -4000, {billId: 'cancelled-bill', purchaseId: 'purchase'}),
    entry('undo', 'reversal', 4000, 4000, {reverses: 'payment'})];
  const r = financialReport(s);
  assert.equal(r.bills.outstanding, 0); assert.equal(r.purchases.rows[0].coveredByBills, false);
  assert.equal(r.purchases.unbilledOutstanding, 10000); assert.equal(r.payables.business.total, 10000);
  assert.equal(r.business.expense, 0);
});

test('enrollment receivables without an Invoice appear once and linked invoices never duplicate them', () => {
  const s = fixture();
  s.customers = [{id: 'customer', name: 'Student'}]; s.courses = [{id: 'course', name: 'ECU course'}];
  s.enrollments = [
    {id: 'invoiced', customerId: 'customer', courseId: 'course', price: 30000, createdAt: '2026-10-01T00:00:00Z'},
    {id: 'not-invoiced', customerId: 'customer', courseId: 'course', price: 20000, createdAt: '2026-11-01T00:00:00Z'},
    {id: 'cancelled-invoice', customerId: 'customer', courseId: 'course', price: 10000, createdAt: '2026-11-01T00:00:00Z'}
  ];
  s.documents = [
    {id: 'invoice', kind: 'invoice', number: 'INV-001', enrollmentId: 'invoiced', customer: {name: 'Student'}, total: 30000, status: 'issued', date: '2026-11-05'},
    {id: 'void', kind: 'invoice', number: 'INV-VOID', enrollmentId: 'cancelled-invoice', total: 10000, status: 'cancelled', date: '2026-11-05'}
  ];
  s.entries = [entry('deposit', 'income', 5000, 5000, {enrollmentId: 'invoiced', date: '2026-12-01'}),
    entry('tuition', 'income', 2000, 2000, {enrollmentId: 'not-invoiced'})];
  const r = financialReport(s);
  assert.equal(r.receivables.invoices, 25000); assert.equal(r.receivables.enrollmentsUninvoiced, 28000); assert.equal(r.receivables.total, 53000);
  assert.equal(r.enrollments.rows.find(row => row.id === 'cancelled-invoice').coveredByInvoices, false);
  assert.equal(r.business.income, 7000); // Obligations are not received income.
  assert.equal(financialReport(s, {from: '2026-10-01', to: '2026-10-31'}).receivables.total, 25000);
  assert.equal(financialReport(s, {from: '2026-11-01', to: '2026-11-30'}).receivables.total, 53000);
  assert.equal(financialReport(s, {search: 'Student', project: 'ECU course'}).receivables.total, 53000);
  assert.equal(r.enrollments.dateBasis, 'record-created-date');
});

test('cancelled invoice and supplier bill rows do not inherit replacement document payments', () => {
  const s = fixture();
  s.enrollments = [{id: 'enrollment', price: 10000}];
  s.documents = [
    {id: 'old-invoice', kind: 'invoice', enrollmentId: 'enrollment', total: 10000, date: '2026-11-01', status: 'cancelled'},
    {id: 'new-invoice', kind: 'invoice', enrollmentId: 'enrollment', total: 10000, date: '2026-11-02', status: 'issued'}
  ];
  s.purchases = [{id: 'purchase', total: 8000, date: '2026-11-01'}];
  s.bills = [
    {id: 'old-bill', purchaseId: 'purchase', total: 8000, date: '2026-11-01', status: 'cancelled'},
    {id: 'new-bill', purchaseId: 'purchase', total: 8000, date: '2026-11-02', status: 'issued'}
  ];
  s.entries = [entry('invoice-receipt', 'income', 3000, 3000, {invoiceId: 'new-invoice', enrollmentId: 'enrollment'}),
    entry('bill-payment', 'expense', 2000, -2000, {billId: 'new-bill', purchaseId: 'purchase'})];
  const r = financialReport(s);
  assert.equal(r.invoices.rows.find(row => row.id === 'old-invoice').paid, 0);
  assert.equal(r.bills.rows.find(row => row.id === 'old-bill').paid, 0);
  assert.equal(r.receivables.total, 7000); assert.equal(r.payables.total, 6000);
});

test('records without transaction dates use their creation date in Bangkok time', () => {
  const s = fixture();
  s.enrollments = [{id: 'enrollment', price: 1000, createdAt: '2026-10-31T18:30:00Z'}];
  s.debts = [{id: 'debt', name: 'Lender', scope: 'business', amount: 2000, createdAt: '2026-10-31T18:30:00Z'}];
  const r = financialReport(s, {from: '2026-11-01', to: '2026-11-01'});
  assert.equal(r.receivables.total, 1000); assert.equal(r.debts.outstanding, 2000);
  assert.equal(r.enrollments.rows[0].date, '2026-11-01'); assert.equal(r.debts.rows[0].date, '2026-11-01');
  assert.equal(financialReport(s, {to: '2026-10-31'}).debts.count, 0);
});
