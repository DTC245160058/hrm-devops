'use strict';
const express = require('express');
const { Pool, types } = require('pg');
const client = require('prom-client');

types.setTypeParser(1082, (v) => v); // kieu DATE giu nguyen chuoi YYYY-MM-DD

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback, uniquelocal');
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

// ---------- Log dang JSON ra stdout (Promtail/Loki doc) ----------
function log(level, msg, extra = {}) {
  console.log(JSON.stringify({ time: new Date().toISOString(), level, msg, ...extra }));
}

// ---------- Ket noi PostgreSQL (user han che quyen) ----------
const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 10,
});
pool.on('connect', (c) => c.query("SET TIME ZONE 'Asia/Ho_Chi_Minh'"));
pool.on('error', (err) => log('error', 'db_pool_error', { error: err.message }));

// ---------- Prometheus metrics ----------
client.collectDefaultMetrics({ prefix: 'hrm_' });
const httpDuration = new client.Histogram({
  name: 'hrm_http_request_duration_seconds',
  help: 'Thoi gian xu ly HTTP request',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2],
});

app.use((req, res, next) => {
  const end = httpDuration.startTimer();
  const start = Date.now();
  res.on('finish', () => {
    const route = req.route ? req.baseUrl + req.route.path : 'unmatched';
    end({ method: req.method, route, status: res.statusCode });
    if (req.path === '/metrics' || req.path === '/health') return;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    log(level, 'http_request', {
      method: req.method, path: req.originalUrl, status: res.statusCode,
      duration_ms: Date.now() - start, ip: req.ip,
    });
  });
  next();
});

// ---------- Tien ich ----------
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nullIfEmpty = (v) => (v === undefined || v === '' ? null : v);
const money = (v) => (v == null ? '' : Number(v).toLocaleString('vi-VN') + ' đ');
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
const STATUS = { present: 'Đúng giờ', late: 'Đi muộn', absent: 'Vắng', leave: 'Nghỉ phép' };

const page = (title, body) => `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} - HRM</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;background:#f4f6f9;color:#222}
nav{background:#1f3a60;padding:12px 24px}nav a{color:#fff;margin-right:20px;text-decoration:none;font-weight:600}
main{max-width:1100px;margin:24px auto;padding:0 16px}
.card{background:#fff;border-radius:8px;padding:14px;margin:10px 0;box-shadow:0 1px 3px #0002}
.stats{display:flex;gap:12px;flex-wrap:wrap}.stats .card{flex:1;min-width:160px;text-align:center}
.stats b{display:block;font-size:2em;color:#1f3a60}
table{width:100%;border-collapse:collapse;background:#fff}th,td{padding:8px;border-bottom:1px solid #ddd;text-align:left}
th{background:#e8eef7}input,select,button{padding:7px;margin:3px}button{background:#1f3a60;color:#fff;border:0;border-radius:4px;cursor:pointer}
button.danger{background:#c0392b}.actions form{display:inline}.row{display:flex;gap:12px;flex-wrap:wrap}
</style></head><body><nav><a href="/">Tổng quan</a><a href="/employees">Nhân viên</a>
<a href="/departments">Phòng ban</a><a href="/attendance">Chấm công</a></nav>
<main><h1>${esc(title)}</h1>${body}</main></body></html>`;

async function deptOptions(selected) {
  const { rows } = await pool.query('SELECT id, name FROM departments ORDER BY name');
  return '<option value="">-- Chưa phân phòng --</option>' + rows.map((d) =>
    `<option value="${d.id}" ${String(d.id) === String(selected) ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
}
const employeeForm = (action, e, options) => `<form method="post" action="${action}" class="card">
  <input name="full_name" placeholder="Họ tên" required maxlength="100" value="${esc(e.full_name)}">
  <input name="email" type="email" placeholder="Email" required maxlength="120" value="${esc(e.email)}">
  <input name="phone" placeholder="SĐT" maxlength="20" value="${esc(e.phone)}">
  <input name="position" placeholder="Chức vụ" maxlength="100" value="${esc(e.position)}">
  <input name="salary" type="number" min="0" step="1000" placeholder="Lương" value="${esc(e.salary)}">
  <select name="department_id">${options}</select>
  <input name="hired_at" type="date" value="${esc(e.hired_at)}">
  <button>Lưu</button></form>`;
const empParams = (b) => [b.full_name, b.email, nullIfEmpty(b.phone), nullIfEmpty(b.position),
  nullIfEmpty(b.salary), nullIfEmpty(b.department_id), nullIfEmpty(b.hired_at)];

// ---------- He thong ----------
app.get('/health', h(async (req, res) => { await pool.query('SELECT 1'); res.json({ status: 'ok' }); }));
app.get('/metrics', h(async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
}));

// ---------- Tong quan ----------
app.get('/', h(async (req, res) => {
  const { rows: [s] } = await pool.query(`SELECT
    (SELECT count(*) FROM employees) AS employees,
    (SELECT count(*) FROM departments) AS departments,
    (SELECT count(*) FROM attendance WHERE work_date = CURRENT_DATE) AS checked_in,
    (SELECT count(*) FROM attendance WHERE work_date = CURRENT_DATE AND status = 'late') AS late`);
  res.send(page('Tổng quan nhân sự', `<div class="stats">
    <div class="card"><b>${s.employees}</b>Nhân viên</div>
    <div class="card"><b>${s.departments}</b>Phòng ban</div>
    <div class="card"><b>${s.checked_in}</b>Đã chấm công hôm nay</div>
    <div class="card"><b>${s.late}</b>Đi muộn hôm nay</div></div>`));
}));

// ---------- Phong ban ----------
app.get('/departments', h(async (req, res) => {
  const { rows } = await pool.query(`SELECT d.id, d.name, d.description, count(e.id) AS total
    FROM departments d LEFT JOIN employees e ON e.department_id = d.id GROUP BY d.id ORDER BY d.name`);
  res.send(page('Phòng ban', `<form method="post" action="/departments" class="card">
    <input name="name" placeholder="Tên phòng ban" required maxlength="100">
    <input name="description" placeholder="Mô tả" maxlength="255"><button>Thêm</button></form>
    <table><tr><th>Tên</th><th>Mô tả</th><th>Số NV</th><th></th></tr>
    ${rows.map((d) => `<tr><td>${esc(d.name)}</td><td>${esc(d.description)}</td><td>${d.total}</td>
      <td><form method="post" action="/departments/${d.id}/delete"><button class="danger">Xóa</button></form></td></tr>`).join('')}
    </table>`));
}));
app.post('/departments', h(async (req, res) => {
  await pool.query('INSERT INTO departments(name, description) VALUES ($1, $2)',
    [req.body.name, nullIfEmpty(req.body.description)]);
  log('info', 'department_created', { name: req.body.name });
  res.redirect('/departments');
}));
app.post('/departments/:id/delete', h(async (req, res) => {
  await pool.query('DELETE FROM departments WHERE id = $1', [req.params.id]);
  log('warn', 'department_deleted', { id: req.params.id });
  res.redirect('/departments');
}));

// ---------- Nhan vien ----------
app.get('/employees', h(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const { rows } = await pool.query(`SELECT e.*, d.name AS department FROM employees e
    LEFT JOIN departments d ON d.id = e.department_id
    WHERE $1::text = '' OR e.full_name ILIKE '%' || $1::text || '%' OR e.email ILIKE '%' || $1::text || '%'
    ORDER BY e.id`, [q]);
  res.send(page('Nhân viên', `<form method="get" class="card">
    <input name="q" placeholder="Tìm theo tên/email" value="${esc(q)}"><button>Tìm</button></form>
    <h2>Thêm nhân viên</h2>${employeeForm('/employees', {}, await deptOptions())}
    <table><tr><th>#</th><th>Họ tên</th><th>Email</th><th>Chức vụ</th><th>Phòng ban</th><th>Lương</th><th>Ngày vào</th><th></th></tr>
    ${rows.map((e) => `<tr><td>${e.id}</td><td>${esc(e.full_name)}</td><td>${esc(e.email)}</td>
      <td>${esc(e.position)}</td><td>${esc(e.department)}</td><td>${money(e.salary)}</td><td>${esc(e.hired_at)}</td>
      <td class="actions"><a href="/employees/${e.id}/edit">Sửa</a>
      <form method="post" action="/employees/${e.id}/delete"><button class="danger">Xóa</button></form></td></tr>`).join('')}
    </table>`));
}));
app.post('/employees', h(async (req, res) => {
  await pool.query(`INSERT INTO employees(full_name, email, phone, position, salary, department_id, hired_at)
    VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::date, CURRENT_DATE))`, empParams(req.body));
  log('info', 'employee_created', { email: req.body.email });
  res.redirect('/employees');
}));
app.get('/employees/:id/edit', h(async (req, res) => {
  const { rows: [e] } = await pool.query('SELECT * FROM employees WHERE id = $1', [req.params.id]);
  if (!e) return res.status(404).send(page('Không tìm thấy', '<p>Nhân viên không tồn tại.</p>'));
  res.send(page('Sửa nhân viên', employeeForm(`/employees/${e.id}`, e, await deptOptions(e.department_id))));
}));
app.post('/employees/:id', h(async (req, res) => {
  await pool.query(`UPDATE employees SET full_name=$1, email=$2, phone=$3, position=$4, salary=$5,
    department_id=$6, hired_at=COALESCE($7::date, hired_at) WHERE id=$8`, [...empParams(req.body), req.params.id]);
  log('info', 'employee_updated', { id: req.params.id });
  res.redirect('/employees');
}));
app.post('/employees/:id/delete', h(async (req, res) => {
  await pool.query('DELETE FROM employees WHERE id = $1', [req.params.id]);
  log('warn', 'employee_deleted', { id: req.params.id });
  res.redirect('/employees');
}));

// ---------- Cham cong ----------
app.get('/attendance', h(async (req, res) => {
  const date = req.query.date || today();
  const { rows } = await pool.query(`SELECT a.*, e.full_name FROM attendance a
    JOIN employees e ON e.id = a.employee_id WHERE a.work_date = $1 ORDER BY a.check_in`, [date]);
  const { rows: emps } = await pool.query('SELECT id, full_name FROM employees ORDER BY full_name');
  const opts = emps.map((e) => `<option value="${e.id}">${esc(e.full_name)}</option>`).join('');
  res.send(page('Chấm công', `<div class="row">
    <form method="post" action="/attendance/checkin" class="card"><select name="employee_id" required>${opts}</select><button>Check-in</button></form>
    <form method="post" action="/attendance/checkout" class="card"><select name="employee_id" required>${opts}</select><button>Check-out</button></form></div>
    <form method="get" class="card">Ngày: <input type="date" name="date" value="${esc(date)}"><button>Xem</button></form>
    <table><tr><th>Nhân viên</th><th>Giờ vào</th><th>Giờ ra</th><th>Trạng thái</th></tr>
    ${rows.map((a) => `<tr><td>${esc(a.full_name)}</td><td>${esc(a.check_in)}</td><td>${esc(a.check_out)}</td>
      <td>${esc(STATUS[a.status] || a.status)}</td></tr>`).join('') || '<tr><td colspan="4">Chưa có dữ liệu</td></tr>'}
    </table>`));
}));
app.post('/attendance/checkin', h(async (req, res) => {
  const r = await pool.query(`INSERT INTO attendance(employee_id, work_date, check_in, status)
    VALUES ($1, CURRENT_DATE, LOCALTIME(0), CASE WHEN LOCALTIME > TIME '08:30' THEN 'late' ELSE 'present' END)
    ON CONFLICT (employee_id, work_date) DO NOTHING`, [req.body.employee_id]);
  log(r.rowCount ? 'info' : 'warn', r.rowCount ? 'check_in' : 'check_in_duplicate', { employee_id: req.body.employee_id });
  res.redirect('/attendance');
}));
app.post('/attendance/checkout', h(async (req, res) => {
  const r = await pool.query(`UPDATE attendance SET check_out = LOCALTIME(0)
    WHERE employee_id = $1 AND work_date = CURRENT_DATE AND check_out IS NULL`, [req.body.employee_id]);
  log(r.rowCount ? 'info' : 'warn', r.rowCount ? 'check_out' : 'check_out_invalid', { employee_id: req.body.employee_id });
  res.redirect('/attendance');
}));

// ---------- 404 va xu ly loi ----------
app.use((req, res) => res.status(404).send(page('404', '<p>Không tìm thấy trang.</p>')));
app.use((err, req, res, next) => {
  const userErr = ['23505', '23503', '23502', '23514', '22P02', '22007', '22008', '22003'].includes(err.code);
  log(userErr ? 'warn' : 'error', 'request_failed', { path: req.originalUrl, code: err.code, error: err.message });
  const msg = err.code === '23505' ? 'Dữ liệu bị trùng (email hoặc tên đã tồn tại).'
    : userErr ? 'Dữ liệu không hợp lệ.' : 'Lỗi hệ thống, vui lòng thử lại.';
  res.status(userErr ? 400 : 500).send(page('Lỗi', `<p>${msg}</p><p><a href="/">Về trang chủ</a></p>`));
});

const server = app.listen(3000, () => log('info', 'server_started', { port: 3000 }));
process.on('SIGTERM', () => {
  log('info', 'shutdown');
  server.close(() => pool.end().then(() => process.exit(0)));
});
