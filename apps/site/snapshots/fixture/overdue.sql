select i.number, c.name as customer, i.total, i.due_on
from invoices i
join customers c on c.id = i.customer_id
where i.status = 'open'
  and i.due_on < date '2026-10-15'
order by i.due_on;
