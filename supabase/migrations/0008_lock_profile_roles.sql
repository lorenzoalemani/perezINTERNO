-- Los roles se asignan desde el SQL Editor por un administrador. Ningún
-- usuario autenticado puede darse de alta ni cambiar su propio rol mediante
-- la API pública.
drop policy if exists "profiles_insert_admin" on profiles;

create policy "profiles_insert_admin" on profiles for insert
  with check (current_role_name() = 'admin');
