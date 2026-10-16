-- The billing-api database, loaded into a throwaway Postgres while the snapshots are captured.

create table customers (
  id serial primary key,
  name text not null,
  email text not null,
  country char(2) not null
);

create table invoices (
  id serial primary key,
  number text not null unique,
  customer_id integer not null references customers (id),
  status text not null check (status in ('draft', 'open', 'paid', 'void')),
  total numeric(10, 2) not null,
  due_on date not null
);

create table webhook_deliveries (
  id serial primary key,
  invoice_id integer not null references invoices (id),
  url text not null,
  attempts integer not null default 0,
  delivered_at timestamptz
);

create index invoices_status_due_on_idx on invoices (status, due_on);

insert into customers (name, email, country) values
  ('Larkspur Coffee', 'accounts@larkspur.example.com', 'IE'),
  ('Halden Studio', 'billing@halden.example.com', 'NL'),
  ('Brightwater Clinic', 'finance@brightwater.example.com', 'DE'),
  ('Moss & Pine', 'hello@mossandpine.example.com', 'FR'),
  ('Quarry Lane Books', 'orders@quarrylane.example.com', 'IE');

insert into invoices (number, customer_id, status, total, due_on) values
  ('INV-1041', 1, 'paid', 240.00, '2026-09-01'),
  ('INV-1042', 2, 'open', 1180.50, '2026-09-20'),
  ('INV-1043', 3, 'open', 96.00, '2026-09-28'),
  ('INV-1044', 4, 'paid', 410.25, '2026-10-01'),
  ('INV-1045', 5, 'open', 75.80, '2026-10-03'),
  ('INV-1046', 1, 'open', 240.00, '2026-10-08'),
  ('INV-1047', 2, 'void', 1180.50, '2026-10-10'),
  ('INV-1048', 3, 'open', 312.40, '2026-10-12'),
  ('INV-1049', 4, 'open', 410.25, '2026-11-01'),
  ('INV-1050', 5, 'draft', 120.00, '2026-11-03');

insert into webhook_deliveries (invoice_id, url, attempts, delivered_at) values
  (1, 'https://hooks.example.com/larkspur', 1, '2026-09-01 10:02:00+00'),
  (2, 'https://hooks.example.com/halden', 5, null),
  (4, 'https://hooks.example.com/moss-and-pine', 2, '2026-10-01 08:15:00+00');
