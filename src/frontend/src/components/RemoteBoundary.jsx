import React, { createContext, useContext } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

// HT-39 / T03: ErrorBoundary para cada microfrontend.
// Si un remote no responde, solo esa sección muestra el aviso; el resto de la app sigue funcionando.
// "Reintentar" limpia el error y vuelve a cargar ESE remote, sin recargar la página.

// Número de intento actual: al cambiar, lazyRemote crea un React.lazy nuevo
// (React.lazy guarda el error de la primera carga y no vuelve a intentarlo por sí solo).
const IntentoContext = createContext(0);

/**
 * Reemplazo de React.lazy para microfrontends, compatible con el botón Reintentar.
 * Uso en App.jsx:
 *   const MapaUrbano = lazyRemote(() => cargarRemote('mf_mapa_urbano', './MapaUrbano'));
 */
export function lazyRemote(cargar) {
  const porIntento = new Map();
  function ComponenteRemoto(props) {
    const intento = useContext(IntentoContext);
    let Lazy = porIntento.get(intento);
    if (!Lazy) {
      Lazy = React.lazy(cargar);
      porIntento.set(intento, Lazy);
    }
    return <Lazy {...props} />;
  }
  return ComponenteRemoto;
}

class RemoteBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, intento: 0 };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error(`[RemoteBoundary] Error en el microfrontend ${this.props.nombre}:`, error, errorInfo);
  }

  // Limpia el error y fuerza una carga nueva del remote
  handleReintentar = () => {
    this.setState((s) => ({ hasError: false, error: null, intento: s.intento + 1 }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="flex flex-col items-center justify-center h-full w-full p-6 text-center animate-fade-in bg-[var(--color-card)] rounded-2xl border border-red-500/30"
        >
          <div className="p-4 bg-red-500/10 rounded-full mb-4">
            <AlertTriangle size={32} className="text-red-400" />
          </div>
          <h3 className="text-lg font-bold mb-2 text-[var(--color-text-primary)]">
            Este módulo no está disponible
          </h3>
          <p className="text-sm text-[var(--color-text-secondary)] mb-6 max-w-md">
            No se pudo cargar <span className="font-mono text-[var(--color-accent)]">{this.props.nombre}</span>.
            El resto de UrbanPulse sigue funcionando.
          </p>
          <button
            onClick={this.handleReintentar}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[var(--color-panel)] border border-[var(--color-border)] text-[var(--color-text-primary)] hover:border-red-400 hover:text-red-400 transition-colors"
          >
            <RefreshCw size={16} />
            <span className="font-medium text-sm">Reintentar</span>
          </button>
          {this.state.intento >= 2 && (
            <button
              onClick={() => window.location.reload()}
              className="mt-3 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-accent-light)] underline"
            >
              Si sigue fallando, recargar la página
            </button>
          )}
        </div>
      );
    }

    // key: monta el contenido desde cero en cada intento
    return (
      <IntentoContext.Provider value={this.state.intento} key={this.state.intento}>
        {this.props.children}
      </IntentoContext.Provider>
    );
  }
}

export default RemoteBoundary;
