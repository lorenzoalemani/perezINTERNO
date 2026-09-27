# Sistema de Hamburguesería — Etapa 1

Esto es lo entregado hasta ahora: **configuración del proyecto + Supabase + autenticación + base de datos**, según la Etapa 1 del plan. El resto de las etapas (productos, nuevo pedido, comandas, caja, estadísticas) se agregan en los próximos pasos, sin romper esta base.

## Qué incluye esta entrega

- Proyecto React + TypeScript + Vite + Tailwind v4.
- Esquema SQL completo en `supabase/migrations/0001_init.sql`: todas las tablas, RLS, funciones RPC (`create_order`, `close_order_with_payment`) y datos de ejemplo (seed).
- Autenticación con Supabase Auth (`src/features/auth`).
- Layout de la app con navegación por secciones.
- Dashboard funcional (lee pedidos/pagos reales de Supabase).
- Rutas protegidas, incluida una ruta solo para `admin` (Productos).
- Páginas placeholder para Nuevo Pedido, Pendientes, Pedidos, Caja, Estadísticas y Productos — se completan en las próximas etapas.

## Cómo levantarlo

1. Creá un proyecto en supabase.com.
2. En el SQL Editor de Supabase, ejecutá el contenido de `supabase/migrations/0001_init.sql`.
3. Creá un usuario desde Authentication > Users, y después insertá su fila correspondiente en `profiles` con `role = 'admin'`:
   ```sql
   insert into profiles (id, full_name, role)
   values ('UUID_DEL_USUARIO', 'Tu Nombre', 'admin');
   ```
4. Copiá `.env.example` a `.env` y completá con la URL y anon key de tu proyecto Supabase (Project Settings > API).
5. Instalá dependencias y corré en modo desarrollo:
   ```bash
   npm install
   npm run dev
   ```

## Deploy

Pensado para Vercel: conectá el repo, configurá las mismas variables de entorno (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) en el proyecto de Vercel, y el build (`npm run build`) ya funciona sin pasos adicionales.

## Siguientes etapas

- Etapa 2: Administración de productos/categorías/modificadores (CRUD completo).
- Etapa 3: Pantalla de Nuevo Pedido (el corazón del sistema).
- Etapa 4: Listado de pedidos, pendientes, estados, historial.
- Etapa 5: Comandas e impresión.
- Etapa 6: Cierre de pedidos, pagos, caja.
- Etapa 7: Estadísticas con gráficos.
- Etapa 8: Pulido de UX, responsive, validaciones, seguridad.
