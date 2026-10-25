import { PipingGraph } from '../graph/PipingGraph';
import { Component } from '../../types/piping';

export interface PcfExportOptions {
  pipelineReference?: string;
  projectIdentifier?: string;
  boreUnits?: 'INCH' | 'MM';
  coordUnits?: 'MM' | 'INCH';
  weightUnits?: 'KGS' | 'LBS';
}

/**
 * Formatea un número en coordenadas con 2 decimales fijos
 */
function fmtCoord(val: number): string {
  return val.toFixed(2);
}

/**
 * Formatea el diámetro nominal
 */
function fmtBore(nd: number): string {
  return nd.toFixed(2);
}

/**
 * Exportador de archivos PCF (Piping Component File) estándar Alias / Hexagon Isogen.
 * Serializa el grafo topológico en bloques de componentes listos para generación de isométricos.
 */
export class PcfExporter {
  /**
   * Genera el contenido de texto plano en formato PCF a partir de un PipingGraph
   */
  public static exportToPcf(graph: PipingGraph, options: PcfExportOptions = {}): string {
    const pipelineRef = options.pipelineReference || 'LINE-101';
    const project = options.projectIdentifier || 'ACHERO_PLANT_3D';
    const boreUnit = options.boreUnits || 'INCH';
    const coordUnit = options.coordUnits || 'MM';
    const weightUnit = options.weightUnits || 'KGS';

    const now = new Date();
    const dateStr = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1)
      .toString()
      .padStart(2, '0')}/${now.getFullYear()}`;

    const lines: string[] = [];

    // Encabezado estándar Isogen
    lines.push('ISOGEN-FILES ISOGEN.FLS');
    lines.push(`UNITS-BORE ${boreUnit}`);
    lines.push(`UNITS-CO-ORDS ${coordUnit}`);
    lines.push(`UNITS-WEIGHT ${weightUnit}`);
    lines.push(`PIPELINE-REFERENCE ${pipelineRef}`);
    lines.push(`    PROJECT-IDENTIFIER ${project}`);
    lines.push(`    DATE-DMY ${dateStr}`);
    lines.push('');

    // Serializar cada componente del grafo
    for (const comp of graph.components.values()) {
      switch (comp.type) {
        case 'PIPE':
          lines.push(...PcfExporter.serializePipe(comp));
          break;
        case 'ELBOW':
          lines.push(...PcfExporter.serializeElbow(comp));
          break;
        case 'TEE':
          lines.push(...PcfExporter.serializeTee(comp));
          break;
        case 'FLANGE':
          lines.push(...PcfExporter.serializeFlange(comp));
          break;
        case 'REDUCER':
          lines.push(...PcfExporter.serializeReducer(comp));
          break;
      }
    }

    return lines.join('\n') + '\n';
  }

  private static serializePipe(comp: Component): string[] {
    if (comp.ports.length < 2) return [];

    const p1 = comp.ports[0];
    const p2 = comp.ports[1];
    const itemCode = comp.catalogId || `PIPE-CS-${p1.nominalDiameter * 100}`;
    const desc = comp.parameters.description || `PIPE ASTM A106 GR.B SCH 40 ${p1.nominalDiameter}"`;
    const wallThick = comp.parameters.wallThickness || p1.wallThickness;

    return [
      'PIPE',
      `    END-POINT ${fmtCoord(p1.position.x)} ${fmtCoord(p1.position.y)} ${fmtCoord(p1.position.z)} ${fmtBore(p1.nominalDiameter)} ${p1.endType}`,
      `    END-POINT ${fmtCoord(p2.position.x)} ${fmtCoord(p2.position.y)} ${fmtCoord(p2.position.z)} ${fmtBore(p2.nominalDiameter)} ${p2.endType}`,
      `    ITEM-CODE ${itemCode}`,
      `    DESCRIPTION ${desc}`,
      `    WALL-THICKNESS ${fmtCoord(wallThick)}`,
      ''
    ];
  }

  private static serializeElbow(comp: Component): string[] {
    if (comp.ports.length < 2) return [];

    const p1 = comp.ports[0];
    const p2 = comp.ports[1];
    const angleDeg = comp.parameters.angle || 90;
    // En PCF estándar el ángulo se suele expresar en centésimas de grado (90° = 9000)
    const anglePcf = Math.round(angleDeg * 100);

    // Vértice central de intersección
    const takeOff = comp.parameters.takeOff || comp.parameters.radius || 76.2;
    const vertex = p1.position.clone().add(p1.direction.clone().negate().multiplyScalar(takeOff));

    const itemCode = comp.catalogId || `ELB${angleDeg}-CS-${p1.nominalDiameter * 100}`;
    const desc = comp.parameters.description || `ELBOW ${angleDeg} LR ASTM A234 WPB SCH 40 ${p1.nominalDiameter}"`;
    const wallThick = comp.parameters.wallThickness || p1.wallThickness;

    return [
      'ELBOW',
      `    END-POINT ${fmtCoord(p1.position.x)} ${fmtCoord(p1.position.y)} ${fmtCoord(p1.position.z)} ${fmtBore(p1.nominalDiameter)} ${p1.endType}`,
      `    END-POINT ${fmtCoord(p2.position.x)} ${fmtCoord(p2.position.y)} ${fmtCoord(p2.position.z)} ${fmtBore(p2.nominalDiameter)} ${p2.endType}`,
      `    CENTRE-POINT ${fmtCoord(vertex.x)} ${fmtCoord(vertex.y)} ${fmtCoord(vertex.z)}`,
      `    ANGLE ${anglePcf}`,
      `    ITEM-CODE ${itemCode}`,
      `    DESCRIPTION ${desc}`,
      `    WALL-THICKNESS ${fmtCoord(wallThick)}`,
      ''
    ];
  }

  private static serializeTee(comp: Component): string[] {
    if (comp.ports.length < 3) return [];

    const pRun1 = comp.ports[0];
    const pRun2 = comp.ports[1];
    const pBranch = comp.ports[2];

    const center = pRun1.position.clone().add(pRun2.position).multiplyScalar(0.5);
    const itemCode = comp.catalogId || `TEE-CS-${pRun1.nominalDiameter * 100}`;
    const desc = comp.parameters.description || `TEE STRAIGHT ASTM A234 WPB SCH 40 ${pRun1.nominalDiameter}"`;

    return [
      'TEE',
      `    END-POINT ${fmtCoord(pRun1.position.x)} ${fmtCoord(pRun1.position.y)} ${fmtCoord(pRun1.position.z)} ${fmtBore(pRun1.nominalDiameter)} ${pRun1.endType}`,
      `    END-POINT ${fmtCoord(pRun2.position.x)} ${fmtCoord(pRun2.position.y)} ${fmtCoord(pRun2.position.z)} ${fmtBore(pRun2.nominalDiameter)} ${pRun2.endType}`,
      `    CENTRE-POINT ${fmtCoord(center.x)} ${fmtCoord(center.y)} ${fmtCoord(center.z)}`,
      `    BRANCH1-POINT ${fmtCoord(pBranch.position.x)} ${fmtCoord(pBranch.position.y)} ${fmtCoord(pBranch.position.z)} ${fmtBore(pBranch.nominalDiameter)} ${pBranch.endType}`,
      `    ITEM-CODE ${itemCode}`,
      `    DESCRIPTION ${desc}`,
      ''
    ];
  }

  private static serializeFlange(comp: Component): string[] {
    if (comp.ports.length < 2) return [];

    const p1 = comp.ports[0];
    const p2 = comp.ports[1];
    const itemCode = comp.catalogId || `FLG-WN-${p1.nominalDiameter * 100}`;
    const desc = comp.parameters.description || `FLANGE WN RF CL 150 ${p1.nominalDiameter}"`;

    return [
      'FLANGE',
      `    END-POINT ${fmtCoord(p1.position.x)} ${fmtCoord(p1.position.y)} ${fmtCoord(p1.position.z)} ${fmtBore(p1.nominalDiameter)} ${p1.endType}`,
      `    END-POINT ${fmtCoord(p2.position.x)} ${fmtCoord(p2.position.y)} ${fmtCoord(p2.position.z)} ${fmtBore(p2.nominalDiameter)} ${p2.endType}`,
      `    ITEM-CODE ${itemCode}`,
      `    DESCRIPTION ${desc}`,
      ''
    ];
  }

  private static serializeReducer(comp: Component): string[] {
    if (comp.ports.length < 2) return [];

    const p1 = comp.ports[0];
    const p2 = comp.ports[1];
    const itemCode = comp.catalogId || `RED-CON-${p1.nominalDiameter * 100}-${p2.nominalDiameter * 100}`;
    const desc = comp.parameters.description || `REDUCER CONC ASTM A234 WPB SCH 40 ${p1.nominalDiameter}"x${p2.nominalDiameter}"`;

    return [
      'REDUCER-CONCENTRIC',
      `    END-POINT ${fmtCoord(p1.position.x)} ${fmtCoord(p1.position.y)} ${fmtCoord(p1.position.z)} ${fmtBore(p1.nominalDiameter)} ${p1.endType}`,
      `    END-POINT ${fmtCoord(p2.position.x)} ${fmtCoord(p2.position.y)} ${fmtCoord(p2.position.z)} ${fmtBore(p2.nominalDiameter)} ${p2.endType}`,
      `    ITEM-CODE ${itemCode}`,
      `    DESCRIPTION ${desc}`,
      ''
    ];
  }
}
