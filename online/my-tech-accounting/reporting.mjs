// Reports use the records that are valid now. Date filters do not reconstruct an
// earlier ledger snapshot, and open balances include payments from all dates.
const reportArray = value => Array.isArray(value) ? value : [];
const reportSum = (rows, value) => rows.reduce((total, row) => total + value(row), 0);
const reportIndex = rows => new Map(reportArray(rows).map(row => [row.id, row]));
const reportIsCancelled = row => row.status === 'cancelled';
const reportMoneyFormat = new Intl.NumberFormat('th-TH', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const reportMoneyText = value => Number.isFinite(value) ? `${value} ${(value / 100).toFixed(2)} ${reportMoneyFormat.format(value / 100)}` : '';
const reportCreatedDateFormat = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'});
const reportCreatedDate = row => row.date || (row.createdAt && !Number.isNaN(Date.parse(row.createdAt)) ? reportCreatedDateFormat.format(new Date(row.createdAt)) : '');

function reportActiveEntries(s) {
  const entries = reportArray(s.entries);
  const reversed = new Set(entries.filter(entry => entry.reverses).map(entry => entry.reverses));
  return entries.filter(entry => !entry.reverses && !reversed.has(entry.id));
}

function reportContext(s) {
  const context = {};
  for (const key of ['accounts', 'documents', 'customers', 'enrollments', 'courses', 'purchases', 'products', 'payroll', 'bills', 'movements', 'debts']) context[key] = reportIndex(s[key]);
  context.paymentPayroll = new Map(reportArray(s.payroll).filter(slip => slip.paymentEntryId).map(slip => [slip.paymentEntryId, slip]));
  return context;
}

function reportMatches(row, filter, date = row.date, project = row.project || '', extra = '') {
  if (filter.from && (!date || date < filter.from)) return false;
  if (filter.to && (!date || date > filter.to)) return false;
  if (filter.project && project !== filter.project) return false;
  const query = String(filter.search || filter.query || '').trim().toLocaleLowerCase();
  return !query || `${JSON.stringify(row)} ${extra}`.toLocaleLowerCase().includes(query);
}

function reportEntry(row, context) {
  const account = context.accounts.get(row.accountId);
  const enrollment = context.enrollments.get(row.enrollmentId);
  const invoice = context.documents.get(row.invoiceId) || (enrollment && [...context.documents.values()].find(doc => doc.kind === 'invoice' && !reportIsCancelled(doc) && doc.enrollmentId === enrollment.id));
  const customer = invoice?.customer || context.customers.get(enrollment?.customerId);
  const payroll = context.payroll.get(row.payrollId) || context.paymentPayroll.get(row.id);
  const bill = context.bills.get(row.billId);
  const purchase = context.purchases.get(row.purchaseId || bill?.purchaseId);
  const product = context.products.get(purchase?.productId);
  const debt = context.debts.get(row.debtId);
  const isSalary = !!row.payrollId || !!payroll || String(row.id || '').startsWith('salary-summary-');
  return {...row, accountName: account?.name || '', accountScope: account?.scope || 'unassigned', isSalary,
    invoiceNumber: invoice?.number || '', customerName: customer?.name || '',
    payrollMonth: payroll?.month || '', employeeName: payroll?.employee?.name || '', employeeCode: payroll?.employee?.code || '',
    billNumber: bill?.number || bill?.reference || '', billCategory: bill?.category || '',
    vendor: bill?.vendor || bill?.supplierName || purchase?.vendor || '', productName: product?.name || '', debtName: debt?.name || ''};
}

function reportScope(entries, scope) {
  const rows = entries.filter(row => row.accountScope === scope);
  const operating = rows.filter(row => ['expense', 'settlement', 'interest'].includes(row.type));
  const expenseRules = [
    ['salary', 'เงินเดือนสุทธิจ่ายแล้ว', row => row.type === 'expense' && row.isSalary],
    ['expense', 'ค่าใช้จ่ายอื่นที่จ่ายแล้ว', row => row.type === 'expense' && !row.isSalary],
    ['settlement', 'ค่าใช้จ่ายจากการเคลียร์เงินเบิก', row => row.type === 'settlement'],
    ['interest', 'ดอกเบี้ยจ่าย', row => row.type === 'interest']
  ];
  const expenses = expenseRules.map(([key, label, accepts]) => ({key, label, amount: reportSum(rows.filter(accepts), row => row.amount), count: rows.filter(accepts).length}));
  const outflowRules = [
    ['salary', 'เงินออกจ่ายเงินเดือนสุทธิ', row => row.type === 'expense' && row.isSalary],
    ['expense', 'เงินออกจ่ายค่าใช้จ่ายอื่น', row => row.type === 'expense' && !row.isSalary],
    ['interest', 'เงินออกจ่ายดอกเบี้ย', row => row.type === 'interest'],
    ['advance', 'เงินเบิกไปซื้อของ', row => row.type === 'advance'],
    ['debt_repay', 'เงินคืนต้นหนี้', row => row.type === 'debt_repay'],
    ['owner_out', 'เจ้าของถอนเงิน', row => row.type === 'owner_out'],
    ['opening', 'ยอดยกมา / การปรับลดยอดยกมา', row => ['opening','opening_adjustment'].includes(row.type)]
  ];
  const cashRows = rows.filter(row => row.cash < 0);
  const outflows = outflowRules.map(([key, label, accepts]) => ({key, label, amount: reportSum(cashRows.filter(accepts), row => -row.cash), count: cashRows.filter(accepts).length}));
  const otherCashRows = cashRows.filter(row => !outflowRules.some(([, , accepts]) => accepts(row)));
  outflows.push({key: 'other', label: 'เงินออกประเภทอื่น', amount: reportSum(otherCashRows, row => -row.cash), count: otherCashRows.length});
  const income = reportSum(rows.filter(row => row.type === 'income'), row => row.amount);
  const expense = reportSum(operating, row => row.amount);
  const cashIn = reportSum(rows.filter(row => row.cash > 0), row => row.cash);
  const cashOut = reportSum(cashRows, row => -row.cash);
  return {scope, count: rows.length, entries: rows, income, expense, cashIn, cashOut, netCash: cashIn - cashOut,
    incomeLessExpense: income - expense, salaryPaid: expenses[0].amount, regularExpense: expenses[1].amount,
    settlement: expenses[2].amount, interestPaid: expenses[3].amount, expenses, outflows};
}

function reportDocuments(s, active, filter, context) {
  const rows = reportArray(s.documents).filter(doc => doc.kind === 'invoice').map(doc => {
    const enrollment = context.enrollments.get(doc.enrollmentId);
    const course = context.courses.get(enrollment?.courseId);
    const paid = reportSum(active.filter(entry => entry.type === 'income' && (entry.invoiceId === doc.id || !reportIsCancelled(doc) && doc.enrollmentId && entry.enrollmentId === doc.enrollmentId)), entry => entry.amount);
    return {...doc, customerName: doc.customer?.name || context.customers.get(doc.customerId)?.name || '',
      project: doc.project || course?.name || '', paid, outstanding: Math.max(0, doc.total - paid),
      currentPaid: paid, currentOutstanding: Math.max(0, doc.total - paid), includedInTotals: !reportIsCancelled(doc)};
  }).filter(row => reportMatches(row, filter, row.date, row.project, reportMoneyText(row.total)));
  const included = rows.filter(row => row.includedInTotals);
  return {rows, rowCount: rows.length, count: included.length, cancelledCount: rows.length - included.length,
    total: reportSum(included, row => row.total), paid: reportSum(included, row => row.paid), outstanding: reportSum(included, row => row.outstanding),
    dateBasis: 'issue-date', balanceBasis: 'current-active-payments-all-dates'};
}

function reportBills(s, active, filter, context) {
  const all = reportArray(s.bills).map(bill => {
    const purchase = context.purchases.get(bill.purchaseId);
    const paid = reportSum(active.filter(entry => ['expense', 'settlement'].includes(entry.type) && (entry.billId === bill.id || !reportIsCancelled(bill) && bill.purchaseId && entry.purchaseId === bill.purchaseId)), entry => entry.amount);
    return {...bill, scope: bill.scope || 'business', vendor: bill.vendor || bill.supplierName || purchase?.vendor || '', project: bill.project || purchase?.project || '',
      paid, outstanding: Math.max(0, bill.total - paid), currentPaid: paid, currentOutstanding: Math.max(0, bill.total - paid), includedInTotals: !reportIsCancelled(bill)};
  });
  const rows = all.filter(row => reportMatches(row, filter, row.date, row.project, reportMoneyText(row.total)));
  const included = rows.filter(row => row.includedInTotals);
  const scoped = scope => {
    const scopedRows = included.filter(row => row.scope === scope);
    return {count: scopedRows.length, total: reportSum(scopedRows, row => row.total), paid: reportSum(scopedRows, row => row.paid), outstanding: reportSum(scopedRows, row => row.outstanding)};
  };
  return {all, rows, rowCount: rows.length, count: included.length, cancelledCount: rows.length - included.length,
    total: reportSum(included, row => row.total), paid: reportSum(included, row => row.paid), outstanding: reportSum(included, row => row.outstanding),
    business: scoped('business'), personal: scoped('personal'),
    dateBasis: 'issue-date', balanceBasis: 'current-active-payments-all-dates'};
}

function reportPayroll(s, active, filter) {
  const activeIds = new Set(active.map(entry => entry.id));
  const fromMonth = filter.from?.slice(0, 7), toMonth = filter.to?.slice(0, 7);
  const rows = reportArray(s.payroll).map(slip => {
    const isPaid = !!slip.paymentEntryId && activeIds.has(slip.paymentEntryId);
    const includedInTotals = !reportIsCancelled(slip);
    return {...slip, scope: 'business', employeeName: slip.employee?.name || '', employeeCode: slip.employee?.code || '', project: 'เงินเดือน', isPaid,
      paidAmount: includedInTotals && isPaid ? slip.net : 0, unpaidAmount: includedInTotals && !isPaid ? slip.net : 0,
      paymentStatus: !includedInTotals ? 'cancelled' : isPaid ? 'paid' : 'unpaid', includedInTotals};
  }).filter(row => (!fromMonth || row.month >= fromMonth) && (!toMonth || row.month <= toMonth)
    && reportMatches(row, {...filter, from: '', to: ''}, '', row.project, reportMoneyText(row.net)));
  const included = rows.filter(row => row.includedInTotals);
  return {rows, rowCount: rows.length, count: included.length, cancelledCount: rows.length - included.length,
    gross: reportSum(included, row => row.gross), deductions: reportSum(included, row => row.totalDeductions), net: reportSum(included, row => row.net),
    paid: reportSum(included, row => row.paidAmount), unpaid: reportSum(included, row => row.unpaidAmount),
    dateBasis: 'payroll-month', balanceBasis: 'current-active-payment'};
}

function reportPurchases(s, active, filter, context, bills, selectedBills) {
  const selectedBillIds = new Set(selectedBills.map(bill => bill.id));
  const rows = reportArray(s.purchases).map(purchase => {
    const linked = bills.filter(bill => bill.purchaseId === purchase.id && bill.includedInTotals);
    const allLinkedIds = new Set(reportArray(s.bills).filter(bill => bill.purchaseId === purchase.id).map(bill => bill.id));
    const paid = reportSum(active.filter(entry => ['expense', 'settlement'].includes(entry.type) && (entry.purchaseId === purchase.id || allLinkedIds.has(entry.billId))), entry => entry.amount);
    const product = context.products.get(purchase.productId);
    return {...purchase, productName: product?.name || '', productSku: product?.sku || '', project: purchase.project || linked[0]?.project || '',
      paid, outstanding: Math.max(0, purchase.total - paid), coveredByBills: linked.length > 0,
      coveredByBillsInReport: linked.some(bill => selectedBillIds.has(bill.id)), linkedBillIds: linked.map(bill => bill.id),
      includedInTotals: !reportIsCancelled(purchase)};
  }).filter(row => reportMatches(row, filter, row.date, row.project, reportMoneyText(row.total)));
  const included = rows.filter(row => row.includedInTotals);
  return {rows, rowCount: rows.length, count: included.length,
    total: reportSum(included, row => row.total), paid: reportSum(included, row => row.paid), outstanding: reportSum(included, row => row.outstanding),
    unbilledOutstanding: reportSum(included.filter(row => !row.coveredByBillsInReport), row => row.outstanding),
    dateBasis: 'purchase-date', balanceBasis: 'current-active-payments-all-dates'};
}

function reportMaterials(s, filter, context) {
  const costs = new Map();
  for (const movement of reportArray(s.movements)) {
    if (!['issue', 'return'].includes(movement.type) || context.products.get(movement.productId)?.kind === 'tool') continue;
    const source = movement.type === 'return' ? context.movements.get(movement.sourceId) : null;
    const project = movement.project || source?.project || '';
    if (!project || !reportMatches({...movement, project}, filter, movement.date, project, context.products.get(movement.productId)?.name || '')) continue;
    costs.set(project, (costs.get(project) || 0) + (movement.type === 'return' ? -movement.value : movement.value));
  }
  const rows = [...costs].map(([project, cost]) => ({project, cost}));
  return {rows, count: rows.length, total: reportSum(rows, row => row.cost), dateBasis: 'movement-date'};
}

function reportDebts(s, active, filter) {
  const rows = reportArray(s.debts).map(debt => {
    const paid = reportSum(active.filter(entry => entry.type === 'debt_repay' && entry.debtId === debt.id), entry => entry.amount);
    return {...debt, date: reportCreatedDate(debt), paid, repaid: paid,
      outstanding: Math.max(0, debt.amount - paid), includedInTotals: !reportIsCancelled(debt)};
  }).filter(row => reportMatches(row, filter, row.date, row.project || '', reportMoneyText(row.amount)));
  const included = rows.filter(row => row.includedInTotals);
  const totals = values => ({count: values.length, principal: reportSum(values, row => row.amount),
    repaid: reportSum(values, row => row.repaid), outstanding: reportSum(values, row => row.outstanding)});
  return {rows, rowCount: rows.length, ...totals(included), business: totals(included.filter(row => row.scope === 'business')),
    personal: totals(included.filter(row => row.scope === 'personal')), dateBasis: 'record-created-date', balanceBasis: 'current-active-payments-all-dates'};
}

function reportEnrollments(s, active, filter, context, selectedInvoices) {
  const selectedInvoiceIds = new Set(selectedInvoices.filter(row => row.includedInTotals).map(row => row.id));
  const rows = reportArray(s.enrollments).map(enrollment => {
    const course = context.courses.get(enrollment.courseId), customer = context.customers.get(enrollment.customerId);
    const linked = reportArray(s.documents).filter(doc => doc.kind === 'invoice' && !reportIsCancelled(doc) && doc.enrollmentId === enrollment.id);
    const paid = reportSum(active.filter(entry => entry.type === 'income' && entry.enrollmentId === enrollment.id), entry => entry.amount);
    return {...enrollment, scope: 'business', date: reportCreatedDate(enrollment),
      project: enrollment.project || course?.name || '', courseName: course?.name || '', customerName: customer?.name || '',
      paid, outstanding: Math.max(0, enrollment.price - paid), linkedInvoiceIds: linked.map(doc => doc.id),
      invoiceNumbers: linked.map(doc => doc.number || '').join(', '), coveredByInvoices: linked.length > 0,
      coveredByInvoicesInReport: linked.some(doc => selectedInvoiceIds.has(doc.id)), includedInTotals: !reportIsCancelled(enrollment)};
  }).filter(row => reportMatches(row, filter, row.date, row.project, reportMoneyText(row.price)));
  const included = rows.filter(row => row.includedInTotals);
  const unrepresentedOutstanding = reportSum(included.filter(row => !row.coveredByInvoicesInReport), row => row.outstanding);
  return {rows, count: included.length, rowCount: rows.length, total: reportSum(included, row => row.price),
    paid: reportSum(included, row => row.paid), outstanding: reportSum(included, row => row.outstanding),
    // When an Invoice is outside the filter, its selected registration is the
    // fallback representation of the debt, never a second receivable.
    uninvoicedOutstanding: unrepresentedOutstanding, unrepresentedOutstanding,
    dateBasis: 'record-created-date', balanceBasis: 'current-active-payments-all-dates'};
}

export function financialReport(s, filter = {}) {
  filter ||= {};
  const context = reportContext(s), active = reportActiveEntries(s);
  const entries = active.map(entry => reportEntry(entry, context)).filter(row => reportMatches(row, filter, row.date, row.project || '', reportMoneyText(row.amount)));
  const business = reportScope(entries, 'business'), personal = reportScope(entries, 'personal');
  const invoices = reportDocuments(s, active, filter, context), billResult = reportBills(s, active, filter, context);
  const purchases = reportPurchases(s, active, filter, context, billResult.all, billResult.rows.filter(row => row.includedInTotals)), payroll = reportPayroll(s, active, filter);
  const {all: reportAllBills, ...bills} = billResult;
  const supplierPayable = bills.outstanding + purchases.unbilledOutstanding;
  const businessSupplier = bills.business.outstanding + purchases.unbilledOutstanding;
  const personalSupplier = bills.personal.outstanding;
  const enrollments = reportEnrollments(s, active, filter, context, invoices.rows);
  return {basis: {kind: 'current-valid-not-as-of', money: 'integer-satang', entries: 'entry-date', documents: 'issue-date',
      payroll: 'payroll-month', debts: 'record-created-date', enrollments: 'record-created-date', balances: 'current-active-payments-all-dates',
      description: 'รายการที่ยังมีผลในปัจจุบันตามช่วงวันที่ ยอดคงค้างหักการรับ/จ่ายที่ยังมีผลทุกวันที่ ไม่ใช่ยอดย้อนหลัง ณ วันสิ้นงวด'},
    business, personal, entries, count: entries.length, invoices, bills, payroll, purchases, enrollments,
    receivables: {invoices: invoices.outstanding, enrollmentsUninvoiced: enrollments.uninvoicedOutstanding,
      total: invoices.outstanding + enrollments.uninvoicedOutstanding},
    payables: {bills: bills.outstanding, purchasesUnbilled: purchases.unbilledOutstanding, total: supplierPayable,
      payroll: payroll.unpaid, totalWithPayroll: supplierPayable + payroll.unpaid,
      business: {bills: bills.business.outstanding, purchasesUnbilled: purchases.unbilledOutstanding, total: businessSupplier, payroll: payroll.unpaid, totalWithPayroll: businessSupplier + payroll.unpaid},
      personal: {bills: personalSupplier, purchasesUnbilled: 0, total: personalSupplier, payroll: 0, totalWithPayroll: personalSupplier}},
    obligations: {supplier: supplierPayable, payroll: payroll.unpaid, total: supplierPayable + payroll.unpaid},
    debts: reportDebts(s, active, filter), materials: reportMaterials(s, filter, context)};
}
