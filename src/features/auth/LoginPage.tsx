import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

export default function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await signIn(email, password);
    setLoading(false);
    if (error) {
      setError('Email o contrasena incorrectos.');
      return;
    }
    navigate('/');
  }

  return (
    <div className="perez-shell flex min-h-screen items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="card w-full max-w-sm space-y-5">
        <div className="space-y-3 text-center">
          <span className="brand-mark mx-auto grid h-20 w-32 place-items-center rounded-lg p-2">
            <img
              src="/brand/perez-logo-real.jpg"
              alt="Perez's Burger"
              className="h-full w-full rounded-md object-contain"
            />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-950">Sistema interno</h1>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <div>
          <label className="mb-1 block text-sm font-bold text-gray-700">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-3"
            autoFocus
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-bold text-gray-700">Contrasena</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-3"
          />
        </div>

        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? 'Ingresando...' : 'Ingresar'}
        </button>
      </form>
    </div>
  );
}
