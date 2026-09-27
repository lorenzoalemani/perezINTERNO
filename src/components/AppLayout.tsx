import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext';

const navItems = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/pedidos/nuevo', label: '+ Nuevo Pedido' },
  { to: '/caja', label: 'Caja', adminOnly: true },
  { to: '/estadisticas', label: 'Estadisticas' },
  { to: '/productos', label: 'Productos', adminOnly: true },
];

export default function AppLayout() {
  const { profile, signOut } = useAuth();
  const visibleNavItems = navItems.filter((item) => !item.adminOnly || profile?.role === 'admin');

  return (
    <div className="perez-shell flex min-h-screen flex-col">
      <header className="brand-header sticky top-0 z-30 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-5">
            <span className="brand-mark grid h-11 w-14 shrink-0 place-items-center rounded-md p-1">
                <img
                  src="/brand/perez-logo-real.jpg"
                  alt="Perez's Burger"
                  className="h-full w-full rounded-md object-contain"
                />
            </span>

            <nav className="hidden gap-1 md:flex">
              {visibleNavItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `rounded-lg px-3 py-2 text-sm font-black transition ${
                      isActive ? 'bg-red-700 text-white' : 'text-gray-600 hover:bg-red-50 hover:text-red-800'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-3 text-sm">
            <span className="hidden text-right text-gray-600 sm:inline">
              {profile?.full_name ?? '...'}
              {profile ? ` - ${profile.role === 'admin' ? 'Administrador' : 'Cajera'}` : ''}
            </span>
            <button
              onClick={signOut}
              className="rounded-lg border border-red-100 bg-white px-3 py-2 font-bold text-gray-500 hover:border-red-300 hover:text-red-800"
            >
              Salir
            </button>
          </div>
        </div>
      </header>

      <nav className="flex gap-1 overflow-x-auto border-b border-red-100 bg-white/95 px-3 py-2 md:hidden">
        {visibleNavItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `whitespace-nowrap rounded-lg px-3 py-2 text-sm font-black ${
                isActive ? 'bg-red-700 text-white' : 'text-gray-600'
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <main className="mx-auto w-full max-w-7xl flex-1 p-4">
        <Outlet />
      </main>
    </div>
  );
}
