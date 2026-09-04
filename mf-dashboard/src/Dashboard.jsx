import { useState, useEffect, useCallback } from 'react';
import './index.css';
import { Activity, BarChart3, Clock, Gauge, AlertTriangle, ShieldAlert, Users, RefreshCw, Loader2 } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend,
} from 'recharts';

// Colores para los gráficos (codificación de datos, no cromática de UI — no cambia con el tema)
const COLORS = ['#A855F7', '#C084FC', '#6366f1', '#14b8a6'];

// Fallback si TE_N8N_DASHBOARD_KPIS_URL no está configurada en el entorno de despliegue
const N8N_DASHBOARD_KPIS_URL = 'https://urbanpulse-n8n.xq33kajky1yy6.us-east-1.cs.amazonlightsail.com/webhook/urbanpulse/dashboard-kpis';

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-[var(--color-panel)] border border-[var(--color-border)] p-3 rounded-lg shadow-lg">
        <p className="text-[var(--color-text-primary)] font-bold mb-1">{label || payload[0].name}</p>
        {payload.map((entry) => (
          <p key={entry.dataKey || entry.name} className="text-[var(--color-accent-light)] font-medium">
            {`${entry.value} ${entry.name || ''}`}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

function KpiCard({ icon: Icon, iconColorClass, label, value }) {
  return (
    <div className="bg-[var(--color-card)] border border-[var(--color-border)] p-5 rounded-2xl flex items-center gap-4">
      <div className={`p-3 bg-[var(--color-bg-app)] rounded-xl border border-[var(--color-border)] ${iconColorClass}`}>
        <Icon size={24} />
      </div>
      <div>
        <p className="text-[var(--color-text-secondary)] text-sm font-medium">{label}</p>
        <h3 className="text-2xl font-bold text-[var(--color-text-primary)]">{value}</h3>
      </div>
    </div>
  );
}

function ChartPanel({ title, children }) {
  return (
    <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-2xl p-6 min-h-[320px] flex flex-col">
      <h3 className="text-base font-bold text-[var(--color-text-primary)] mb-4">{title}</h3>
      <div className="flex-1 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [status, setStatus] = useState('loading');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  // Solo hace la petición: no toca el estado, para poder llamarla desde el
  // efecto sin disparar setState de forma síncrona (react-hooks/set-state-in-effect).
  const pedirKpis = useCallback(async () => {
    const webhookUrl = import.meta.env.TE_N8N_DASHBOARD_KPIS_URL || N8N_DASHBOARD_KPIS_URL;
    const response = await fetch(webhookUrl);

    if (!response.ok) {
      throw new Error(`Error de conexión con n8n: ${response.status}`);
    }

    return response.json();
  }, []);

  const manejarError = useCallback((err) => {
    console.error('Error cargando KPIs del dashboard:', err);
    setError(err.message || 'No se pudo conectar con el servidor de métricas.');
    setStatus('error');
  }, []);

  // Carga inicial: el estado se actualiza dentro de los callbacks de la promesa,
  // nunca de forma síncrona en el cuerpo del efecto.
  useEffect(() => {
    let activo = true;

    pedirKpis()
      .then((json) => {
        if (!activo) return;
        setData(json);
        setStatus('success');
      })
      .catch((err) => {
        if (!activo) return;
        manejarError(err);
      });

    return () => {
      activo = false;
    };
  }, [pedirKpis, manejarError]);

  // Recarga manual desde el botón "Actualizar"
  const cargarKpis = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      setData(await pedirKpis());
      setStatus('success');
    } catch (err) {
      manejarError(err);
    }
  }, [pedirKpis, manejarError]);

  const kpis = data?.kpis;
  const charts = data?.charts;

  return (
    <div className="h-full overflow-y-auto space-y-6">

      {/* CABECERA */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="text-[var(--color-accent)]" size={22} />
          <h2 className="text-lg font-bold text-[var(--color-text-primary)]">Panel Analítico UrbanPulse</h2>
        </div>
        <button
          onClick={cargarKpis}
          disabled={status === 'loading'}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--color-card)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent-light)] hover:border-[var(--color-border)]/50 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={16} className={status === 'loading' ? 'animate-spin' : ''} />
          <span className="text-sm font-medium">Actualizar</span>
        </button>
      </div>

      {status === 'loading' && !data && (
        <div className="flex flex-col items-center justify-center py-24 text-[var(--color-accent)]">
          <Loader2 size={32} className="animate-spin mb-4" />
          <p className="text-[var(--color-text-secondary)]">Cargando métricas de la ciudad...</p>
        </div>
      )}

      {status === 'error' && !data && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <AlertTriangle size={40} className="text-red-400 mb-4" />
          <p className="text-[var(--color-text-primary)] font-medium mb-1">No se pudieron cargar los KPIs</p>
          <p className="text-[var(--color-text-secondary)] text-sm max-w-md">{error}</p>
        </div>
      )}

      {kpis && (
        <>
          {/* TARJETAS DE KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <KpiCard icon={BarChart3} iconColorClass="text-[var(--color-accent)]" label="Total de Reportes" value={kpis.total_reportes} />
            <KpiCard icon={Clock} iconColorClass="text-[var(--color-accent-light)]" label="Reportes Últimas 24h" value={kpis.reportes_ultimas_24h} />
            <KpiCard icon={Gauge} iconColorClass="text-amber-400" label="Congestión Promedio" value={kpis.congestion_promedio != null ? `${kpis.congestion_promedio}%` : '—'} />
            <KpiCard icon={AlertTriangle} iconColorClass="text-red-400" label="Puntos Congestionados" value={`${kpis.puntos_congestionados ?? 0}/${kpis.total_puntos_monitoreo ?? 0}`} />
            <KpiCard icon={ShieldAlert} iconColorClass="text-emerald-400" label="Siniestros Fatales ONSV (histórico)" value={kpis.total_siniestros_fatales} />
            <KpiCard icon={Users} iconColorClass="text-[var(--color-accent)]" label="Fallecidos ONSV (histórico)" value={kpis.total_fallecidos_historico} />
            <KpiCard icon={ShieldAlert} iconColorClass="text-orange-400" label="Siniestros SUTRAN (carreteras)" value={kpis.total_siniestros_sutran} />
            <KpiCard icon={Users} iconColorClass="text-orange-400" label="Fallecidos y Heridos SUTRAN" value={`${kpis.total_fallecidos_sutran ?? 0} / ${kpis.total_heridos_sutran ?? 0}`} />
          </div>

          {/* GRÁFICOS */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartPanel title="Reportes por tipo de incidente">
              <BarChart data={charts.reportes_por_tipo}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="name" stroke="var(--color-text-secondary)" tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis stroke="var(--color-text-secondary)" tick={{ fill: 'var(--color-text-secondary)' }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--color-border)', opacity: 0.4 }} />
                <Bar dataKey="value" name="reportes" fill="var(--color-accent)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ChartPanel>

            <ChartPanel title="Reportes por severidad">
              <PieChart>
                <Pie data={charts.reportes_por_severidad} cx="50%" cy="50%" innerRadius={70} outerRadius={110} paddingAngle={5} dataKey="value" stroke="none">
                  {charts.reportes_por_severidad?.map((entry, index) => (
                    <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ChartPanel>

            <ChartPanel title="Tendencia de reportes (30 días)">
              <LineChart data={charts.tendencia_reportes_30d}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="name" stroke="var(--color-text-secondary)" tick={{ fill: 'var(--color-text-secondary)', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis stroke="var(--color-text-secondary)" tick={{ fill: 'var(--color-text-secondary)' }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Line type="monotone" dataKey="value" name="reportes" stroke="var(--color-accent)" strokeWidth={2} dot={false} />
              </LineChart>
            </ChartPanel>

            <ChartPanel title="Siniestros fatales ONSV por distrito">
              <BarChart data={charts.siniestros_por_distrito} layout="vertical" margin={{ left: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                <XAxis type="number" stroke="var(--color-text-secondary)" tick={{ fill: 'var(--color-text-secondary)' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" stroke="var(--color-text-secondary)" tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }} axisLine={false} tickLine={false} width={100} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--color-border)', opacity: 0.4 }} />
                <Bar dataKey="value" name="siniestros" fill="var(--color-accent-light)" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ChartPanel>

            <ChartPanel title="Siniestros fatales ONSV por clase">
              <BarChart data={charts.siniestros_por_clase}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="name" stroke="var(--color-text-secondary)" tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis stroke="var(--color-text-secondary)" tick={{ fill: 'var(--color-text-secondary)' }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--color-border)', opacity: 0.4 }} />
                <Legend wrapperStyle={{ fontSize: 12, color: 'var(--color-text-secondary)' }} />
                <Bar dataKey="value" name="siniestros" fill="var(--color-accent)" radius={[6, 6, 0, 0]} />
                <Bar dataKey="fallecidos" name="fallecidos" fill="#EF4444" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ChartPanel>

            <ChartPanel title="Siniestros SUTRAN por departamento">
              <BarChart data={charts.siniestros_sutran_por_departamento} layout="vertical" margin={{ left: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                <XAxis type="number" stroke="var(--color-text-secondary)" tick={{ fill: 'var(--color-text-secondary)' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" stroke="var(--color-text-secondary)" tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }} axisLine={false} tickLine={false} width={100} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--color-border)', opacity: 0.4 }} />
                <Bar dataKey="value" name="siniestros" fill="#fb923c" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ChartPanel>

            <ChartPanel title="Siniestros SUTRAN por modalidad">
              <BarChart data={charts.siniestros_sutran_por_modalidad}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="name" stroke="var(--color-text-secondary)" tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis stroke="var(--color-text-secondary)" tick={{ fill: 'var(--color-text-secondary)' }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--color-border)', opacity: 0.4 }} />
                <Legend wrapperStyle={{ fontSize: 12, color: 'var(--color-text-secondary)' }} />
                <Bar dataKey="value" name="siniestros" fill="#fb923c" radius={[6, 6, 0, 0]} />
                <Bar dataKey="fallecidos" name="fallecidos" fill="#EF4444" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ChartPanel>
          </div>

          {data.generated_at && (
            <p className="text-xs text-[var(--color-text-secondary)] text-right">
              Última actualización: {new Date(data.generated_at).toLocaleString()}
            </p>
          )}
        </>
      )}
    </div>
  );
}
