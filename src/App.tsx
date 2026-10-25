import { useEffect } from 'react';
import { usePipingStore } from './store/usePipingStore';
import { CanvasViewer } from './viewport/CanvasViewer';
import { TopNavigation } from './ui/TopNavigation';
import { TouchCompass } from './ui/TouchCompass';
import { TouchNumpad } from './ui/TouchNumpad';
import { ReticleCrosshair } from './ui/ReticleCrosshair';
import { BomModal } from './ui/BomModal';
import { ExportModal } from './ui/ExportModal';
import { ToolPaletteModal } from './ui/ToolPaletteModal';
import { PropertiesInspector } from './ui/PropertiesInspector';

export default function App() {
  const initialize = usePipingStore((s) => s.initialize);
  const isExportOpen = usePipingStore((s) => s.isExportOpen);
  const toggleExport = usePipingStore((s) => s.toggleExport);

  useEffect(() => {
    initialize();
  }, [initialize]);

  return (
    <div
      className="relative w-screen h-screen overflow-hidden bg-cad-dark select-none"
      style={{ touchAction: 'none' }}
    >
      {/* Barra Ribbon superior estilo AutoCAD Plant 3D 2027 */}
      <TopNavigation />

      {/* Viewport 3D Three.js táctil e interactivo */}
      <div className="absolute inset-0 z-0">
        <CanvasViewer />
      </div>

      {/* Paleta de Herramientas acoplada a la izquierda + Inspector de Piezas y Ramales de Te */}
      <PropertiesInspector />

      {/* Retícula central de precisión y snapping */}
      <ReticleCrosshair />

      {/* ViewCube 3D (TOP/FRONT/RIGHT/ISO) + Compás WCS */}
      <TouchCompass />

      {/* Barra inferior de Línea de Comandos + Dynamic Input estilo AutoCAD */}
      <TouchNumpad />

      {/* Modal de Catálogo Completo de Accesorios de Cañería */}
      <ToolPaletteModal />

      {/* Modal de Cómputo de Materiales (BOM) */}
      <BomModal />

      {/* Modal de Exportación de Entregables CAD (PCF y DXF) */}
      <ExportModal isOpen={isExportOpen} onClose={toggleExport} />
    </div>
  );
}
