import type { PipingGraph } from '../core/graph/PipingGraph';
import { LinePcf, PcfExporter, PcfExportOptions } from '../core/exporters/PcfExporter';
import { validateModel } from '../core/validation/validateModel';
import { knownSpecCodes } from '../core/specs/builtInSpecs';
import { downloadFile, shareFiles } from '../utils/fileDownloader';

/** Piezas cuya spec la app no tiene: en Plant quedarían como piezas provisorias */
export function piecesOutsideSpec(graph: PipingGraph, specName?: string): number {
  return validateModel(graph, { knownSpecs: knownSpecCodes(graph.activeSpec, specName) })
    .filter((i) => i.code === 'SPEC_UNKNOWN')
    .reduce((n, i) => n + i.componentIds.length, 0);
}

/**
 * Descarga un PCF por línea. Varios archivos seguidos: con una pausa corta entre uno y otro,
 * porque algunos navegadores frenan descargas simultáneas.
 */
export function downloadLinePcfs(files: LinePcf[], suffix = ''): void {
  files.forEach((f, i) => {
    const name = suffix ? f.fileName.replace(/\.pcf$/i, `${suffix}.pcf`) : f.fileName;
    if (i === 0) downloadFile(name, f.content, 'text/plain');
    else setTimeout(() => downloadFile(name, f.content, 'text/plain'), i * 450);
  });
}

function formatPcfSummary(graph: PipingGraph, files: LinePcf[], verb: string, specName?: string): string {
  const outside = piecesOutsideSpec(graph, specName);
  const what =
    files.length === 1
      ? `PCF ${verb}: ${files[0].fileName} (${files[0].componentCount} piezas).`
      : `${files.length} PCF ${verb}s, uno por línea: ${files.map((f) => f.fileName).join(', ')}.`;
  const warn = outside ? ` Ojo: ${outside} pieza${outside > 1 ? 's' : ''} con una spec que la app no tiene; en Plant quedarían como provisorias.` : '';
  return `${what}${warn} En Plant: abrí el dibujo desde el Project Manager y usá PCF to Pipe.`;
}

/** Exporta el modelo a Plant 3D, un PCF por línea, y arma el mensaje para la barra de estado */
export function quickExportPcf(graph: PipingGraph, specName?: string, options: Omit<PcfExportOptions, 'componentIds' | 'pipelineReference'> = {}): string {
  const files = PcfExporter.exportByLine(graph, { projectIdentifier: 'ACHERO_PLANT_3D', ...options });
  downloadLinePcfs(files);
  return formatPcfSummary(graph, files, 'exportado', specName);
}

/** En móvil intenta compartir los PCF por WhatsApp/Mail/Drive; si no está disponible, los descarga */
export async function shareOrExportPcf(
  graph: PipingGraph,
  specName?: string,
  options: Omit<PcfExportOptions, 'componentIds' | 'pipelineReference'> = {}
): Promise<string> {
  const files = PcfExporter.exportByLine(graph, { projectIdentifier: 'ACHERO_PLANT_3D', ...options });
  const shared = await shareFiles(
    files.map((f) => ({ filename: f.fileName, content: f.content, mimeType: 'text/plain' })),
    files.length === 1 ? files[0].fileName : `PCF (${files.length} líneas)`
  );
  if (shared) return formatPcfSummary(graph, files, 'compartido', specName);
  downloadLinePcfs(files);
  return formatPcfSummary(graph, files, 'exportado', specName);
}
