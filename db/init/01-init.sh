#!/bin/bash
# Chi chay 1 lan khi volume DB con trong
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<EOSQL
-- Tai khoan han che quyen
CREATE ROLE ${APP_DB_USER} LOGIN PASSWORD '${APP_DB_PASSWORD}';
CREATE ROLE ${EXPORTER_DB_USER} LOGIN PASSWORD '${EXPORTER_DB_PASSWORD}';
GRANT pg_monitor TO ${EXPORTER_DB_USER};
REVOKE ALL ON DATABASE ${POSTGRES_DB} FROM PUBLIC;
GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO ${APP_DB_USER}, ${EXPORTER_DB_USER};
REVOKE ALL ON SCHEMA public FROM PUBLIC;

CREATE TABLE departments (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE employees (
  id SERIAL PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  email VARCHAR(120) NOT NULL UNIQUE,
  phone VARCHAR(20),
  position VARCHAR(100),
  salary NUMERIC(12,0) CHECK (salary >= 0),
  department_id INT REFERENCES departments(id) ON DELETE SET NULL,
  hired_at DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE attendance (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date DATE NOT NULL DEFAULT CURRENT_DATE,
  check_in TIME,
  check_out TIME,
  status VARCHAR(20) NOT NULL DEFAULT 'present'
         CHECK (status IN ('present','late','absent','leave')),
  UNIQUE (employee_id, work_date)
);
CREATE INDEX idx_emp_dept ON employees(department_id);
CREATE INDEX idx_att_date ON attendance(work_date);

INSERT INTO departments(name, description) VALUES
 ('Phòng Nhân sự','Tuyển dụng, đào tạo'),
 ('Phòng Kỹ thuật','Phát triển phần mềm'),
 ('Phòng Kế toán','Tài chính, lương'),
 ('Phòng Kinh doanh','Bán hàng, khách hàng');
INSERT INTO employees(full_name,email,phone,position,salary,department_id,hired_at) VALUES
 ('Nguyễn Văn An','an.nv@hrm.vn','0901000001','Trưởng phòng',25000000,1,'2021-03-01'),
 ('Trần Thị Bình','binh.tt@hrm.vn','0901000002','Lập trình viên',18000000,2,'2022-06-15'),
 ('Lê Văn Cường','cuong.lv@hrm.vn','0901000003','DevOps',20000000,2,'2023-01-10'),
 ('Phạm Thị Dung','dung.pt@hrm.vn','0901000004','Kế toán viên',15000000,3,'2022-09-01'),
 ('Hoàng Văn Em','em.hv@hrm.vn','0901000005','Nhân viên KD',12000000,4,'2024-02-20');
INSERT INTO attendance(employee_id,work_date,check_in,check_out,status) VALUES
 (1,CURRENT_DATE-1,'08:00','17:30','present'),
 (2,CURRENT_DATE-1,'08:45','17:30','late'),
 (3,CURRENT_DATE-1,'08:10','18:00','present');

-- App chi duoc CRUD du lieu, KHONG duoc DROP/ALTER/CREATE
GRANT USAGE ON SCHEMA public TO ${APP_DB_USER};
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_DB_USER};
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_DB_USER};
EOSQL
