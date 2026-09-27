-- Descripcion opcional para administrar el menu desde Productos.
alter table products
  add column if not exists description text;
