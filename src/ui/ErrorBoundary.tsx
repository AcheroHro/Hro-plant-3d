import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Error no capturado en Achero Plant 3D:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen w-screen bg-cad-dark text-slate-100 p-6 select-none">
          <div className="max-w-md bg-cad-surface border border-rose-600/50 rounded-2xl p-6 shadow-2xl text-center space-y-4">
            <div className="text-4xl">⚠️</div>
            <h2 className="text-lg font-bold text-rose-400">Error en Achero Plant 3D</h2>
            <p className="text-xs text-slate-300 leading-relaxed">
              Ocurrió un problema al inicializar los gráficos 3D o la base de datos de especificaciones.
            </p>
            {this.state.error && (
              <pre className="bg-cad-panel p-3 rounded-xl text-[11px] font-mono text-rose-300 text-left overflow-x-auto border border-rose-900/40">
                {this.state.error.message}
              </pre>
            )}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 rounded-xl bg-cad-accent text-cad-dark font-bold text-xs shadow-lg"
            >
              Reiniciar Aplicación
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
