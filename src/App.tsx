import { useEffect } from 'react';
import { usePipingStore } from './store/usePipingStore';
import { CanvasViewer } from './viewport/CanvasViewer';
import { TopNavigation } from './ui/TopNavigation';
import { TouchCompass } from './ui/TouchCompass';
import { TouchNumpad } from './ui/TouchNumpad';
import { ReticleCrosshair } from './ui/ReticleCrosshair';
import { BomModal } from './ui/BomModal';
import { SpoolsModal } from './ui/SpoolsModal';
import { ExportModal } from './ui/ExportModal';
import { ToolPaletteModal } from './ui/ToolPaletteModal';
import { QuickToolPalette } from './ui/QuickToolPalette';
import { PropertiesInspector } from './ui/PropertiesInspector';
import { ProjectsModal } from './ui/ProjectsModal';
import { FieldModal } from './ui/FieldModal';
import { PwaBanner } from './ui/PwaBanner';
import { MobileBar } from './ui/MobileBar';
import { PieceMenu } from './ui/PieceMenu';
import { MultiSelectBar } from './ui/MultiSelectBar';
import { ModelCheck } from './ui/ModelCheck';
import { HelpSheet } from './ui/HelpSheet';
import { GuidedTour } from './ui/GuidedTour';
import { getPhoneLayout } from './ui/useIsPhone';
import { useProjectStore } from './store/useProjectStore';
import { listenIncomingFiles } from './pwa/pwa';

export default function App() {
  const initialize = usePipingStore((s) => s.initialize);
  const isExportOpen = usePipingStore((s) => s.isExportOpen);
  const toggleExport = usePipingStore((s) => s.toggleExport);

  useEffect(() => {
    // En el teléfono la cámara sigue a la boca activa: después de cada tramo queda a la vista
    if (getPhoneLayout()) usePipingStore.getState().setCameraMode('ROUTE_MODE');
  }, []);

  useEffect(() => {
    let alive = true;
    initialize().then((project) => {
      if (!alive) return;
      useProjectStore.getState().attach(project);
      // PCF abiertos con la app o compartidos desde WhatsApp / Drive: un proyecto por archivo
      listenIncomingFiles((files) => void useProjectStore.getState().importFiles(files));
    });
    return () => {
      alive = false;
    };
  }, [initialize]);

  return (
    <div
      className="relative w-screen h-screen overflow-hidden bg-cad-dark select-none"
      style={{ touchAction: 'none' }}
    >
      {/* Barra Ribbon superior estilo AutoCAD Plant 3D 2027 + Conmutadores de Paletas */}
      <TopNavigation />

      {/* Viewport 3D Three.js táctil e interactivo */}
      <div className="absolute inset-0 z-0">
        <CanvasViewer />
      </div>

      {/* Paleta Flotante de Inserción Rápida de Piezas (Arrastrable, 1C/2C/Horizontal, Minimizable, Cerrable) */}
      <QuickToolPalette />

      {/* Paleta Flotante de Bocas Libres + Inspector de Propiedades Configurable */}
      <PropertiesInspector />

      {/* Retícula central de precisión y snapping */}
      <ReticleCrosshair />

      {/* Paleta Flotante ViewCube 3D (TOP/FRONT/RIGHT/ISO) + Compás WCS */}
      <TouchCompass />

      {/* Paleta Flotante de Línea de Comandos + Dynamic Input estilo AutoCAD */}
      <TouchNumpad />

      {/* Teléfono: barra de pestañas que abre un panel a la vez */}
      <MobileBar />

      {/* Edición con gestos: menú de la pieza apretada y barra de selección múltiple */}
      <PieceMenu />
      <MultiSelectBar />

      {/* Revisión del modelo, ayuda con los gestos y recorrido guiado */}
      <ModelCheck />
      <HelpSheet />
      <GuidedTour />

      {/* Modal de Catálogo Completo de Accesorios de Cañería */}
      <ToolPaletteModal />

      {/* Modal de Cómputo de Materiales (BOM) */}
      <BomModal />
      <SpoolsModal />
      <ProjectsModal />
      <FieldModal />
      <PwaBanner />

      {/* Modal de Exportación de Entregables CAD (PCF y DXF) */}
      <ExportModal isOpen={isExportOpen} onClose={toggleExport} />
    </div>
  );
}
