import { create } from 'zustand';

/**
 * Instalación, funcionamiento sin conexión y actualización de la app (service worker), y
 * archivos que llegan desde otras apps del teléfono (Compartir) o desde "Abrir con".
 */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface IncomingFile {
  name: string;
  text: string;
}

interface PwaState {
  online: boolean;
  /** Hay una versión nueva descargada esperando */
  updateReady: boolean;
  /** Todos los archivos quedaron guardados para usar sin señal */
  offlineReady: boolean;
  canInstall: boolean;
  installed: boolean;
  install: () => Promise<void>;
  applyUpdate: () => void;
}

let deferredPrompt: InstallPromptEvent | null = null;
let waitingWorker: ServiceWorker | null = null;

const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

export const usePwaStore = create<PwaState>((set) => ({
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  updateReady: false,
  offlineReady: false,
  canInstall: false,
  installed: isStandalone(),
  install: async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    deferredPrompt = null;
    set({ canInstall: false, installed: choice.outcome === 'accepted' });
  },
  applyUpdate: () => {
    if (!waitingWorker) return;
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
    waitingWorker.postMessage('SKIP_WAITING');
  }
}));

function trackWaiting(reg: ServiceWorkerRegistration) {
  const mark = (w: ServiceWorker | null) => {
    if (!w) return;
    waitingWorker = w;
    usePwaStore.setState({ updateReady: true });
  };
  // Si no había controlador, este es el primer service worker: no es una "actualización"
  if (reg.waiting && navigator.serviceWorker.controller) mark(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    w?.addEventListener('statechange', () => {
      if (w.state !== 'installed') return;
      if (navigator.serviceWorker.controller) mark(w);
      else usePwaStore.setState({ offlineReady: true });
    });
  });
}

export function setupPwa(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('online', () => usePwaStore.setState({ online: true }));
  window.addEventListener('offline', () => usePwaStore.setState({ online: false }));
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as InstallPromptEvent;
    usePwaStore.setState({ canInstall: true });
  });
  window.addEventListener('appinstalled', () => usePwaStore.setState({ installed: true, canInstall: false }));

  if (!('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD) {
    // En desarrollo no hay service worker: se borra el de versiones anteriores para no ver código viejo
    navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
    return;
  }
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        trackWaiting(reg);
        if (navigator.serviceWorker.controller) usePwaStore.setState({ offlineReady: true });
        // Buscar versión nueva al volver a la app
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible' && navigator.onLine) reg.update().catch(() => undefined);
        });
      })
      .catch((err) => console.warn('Service worker no registrado:', err));
  });
}

/** Archivos abiertos con la app ("Abrir con" en la PC) o compartidos desde otra app del teléfono */
export function listenIncomingFiles(onFiles: (files: IncomingFile[]) => void): void {
  if (typeof window === 'undefined') return;

  type LaunchParams = { files?: { getFile: () => Promise<File> }[] };
  const lq = (window as Window & { launchQueue?: { setConsumer: (cb: (p: LaunchParams) => void) => void } }).launchQueue;
  lq?.setConsumer(async (params) => {
    if (!params.files?.length) return;
    const files = await Promise.all(params.files.map(async (h) => {
      const f = await h.getFile();
      return { name: f.name, text: await f.text() };
    }));
    onFiles(files);
  });

  const url = new URL(window.location.href);
  if (url.searchParams.get('shared') !== '1' || !('caches' in window)) return;
  url.searchParams.delete('shared');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  (async () => {
    const cache = await caches.open('achero-shared');
    const keys = await cache.keys();
    const files: IncomingFile[] = [];
    for (const req of keys) {
      const res = await cache.match(req);
      if (res) {
        const name = decodeURIComponent(res.headers.get('X-File-Name') || 'compartido.pcf');
        files.push({ name, text: await res.text() });
      }
      await cache.delete(req);
    }
    if (files.length) onFiles(files);
  })().catch((err) => console.warn('No se pudieron leer los archivos compartidos:', err));
}
