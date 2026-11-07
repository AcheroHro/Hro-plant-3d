import { PipingGraph } from '../graph/PipingGraph';
import { Component, Joint } from '../../types/piping';

export interface PcfExportOptions {
  pipelineReference?: string;
  projectIdentifier?: string;
  boreUnits?: 'INCH' | 'MM';
  coordUnits?: 'MM' | 'INCH';
  weightUnits?: 'KGS' | 'LBS';
  includeWeldsAndFasteners?: boolean;
  includeMaterialsTable?: boolean;
}

/**
 * Formatea un número en coordenadas con 2 decimales fijos
 */
function fmtCoord(val: number): string {
  return val.toFixed(2);
}

/**
 * Convierte pulgadas nominales a DN milimétrico estándar si UNITS-BORE es MM
 */
function ndToMetricDn(ndInches: number): number {
  const dnMap: Record<number, number> = {
    0.5: 15,
    0.75: 20,
    1: 25,
    1.25: 32,
    1.5: 40,
    2: 50,
    2.5: 65,
    3: 80,
    3.5: 90,
    4: 100,
    5: 125,
    6: 150,
    8: 200,
    10: 250,
    12: 300
  };
  return dnMap[ndInches] || Math.round(ndInches * 25.4);
}

/**
 * Formatea el diámetro nominal según la unidad seleccionada (INCH o MM)
 */
function fmtBore(nd: number, boreUnit: 'INCH' | 'MM' = 'INCH'): string {
  if (boreUnit === 'MM') {
    return `${ndToMetricDn(nd)}`;
  }
  return nd.toFixed(2);
}

/**
 * Exportador de archivos PCF (Piping Component File) estándar Alias / Hexagon Isogen
 * y AutoCAD Plant 3D (PnPIsoPCFWriter).
 * Serializa el grafo topológico completo (niples, codos, tees, bridas, válvulas,
 * reducciones, soldaduras, juntas, espárragos y tabla de materiales).
 */
export class PcfExporter {
  /**
   * Genera el contenido de texto plano en formato PCF a partir de un PipingGraph
   */
  public static exportToPcf(graph: PipingGraph, options: PcfExportOptions = {}): string {
    const pipelineRef = options.pipelineReference || graph.activeLineNumber || 'LINE-101';
    const project = options.projectIdentifier || 'ACHERO_PLANT_3D';
    const boreUnit = options.boreUnits || 'INCH';
    const coordUnit = options.coordUnits || 'MM';
    const weightUnit = options.weightUnits || 'KGS';
    const includeWelds = options.includeWeldsAndFasteners ?? true;
    const includeMaterials = options.includeMaterialsTable ?? true;

    const now = new Date();
    const dateStr = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1)
      .toString()
      .padStart(2, '0')}/${now.getFullYear()}`;

    const lines: string[] = [];
    const materialsMap = new Map<string, string>();

    const registerMaterial = (itemCode: string, description: string) => {
      if (itemCode && description && !materialsMap.has(itemCode)) {
        materialsMap.set(itemCode, description);
      }
    };

    // Encabezado estándar Isogen / AutoCAD Plant 3D
    lines.push('ISOGEN-FILES ISOGEN.FLS');
    lines.push(`UNITS-BORE ${boreUnit}`);
    lines.push(`UNITS-CO-ORDS ${coordUnit}`);
    lines.push(`UNITS-WEIGHT ${weightUnit}`);
    lines.push('UNITS-BOLT-DIA INCH');
    lines.push('UNITS-BOLT-LENGTH MM');
    lines.push(`PIPELINE-REFERENCE ${pipelineRef}`);
    lines.push(`    PROJECT-IDENTIFIER ${project}`);
    lines.push(`    PIPING-SPEC ${graph.activeSpec}`);
    lines.push(`    DATE-DMY ${dateStr}`);
    lines.push('');

    let pipeSeq = 1;

    // Serializar cada componente del grafo
    for (const comp of graph.components.values()) {
      switch (comp.type) {
        case 'PIPE':
          lines.push(...PcfExporter.serializePipe(comp, boreUnit, pipeSeq++, registerMaterial));
          break;
        case 'ELBOW':
          lines.push(...PcfExporter.serializeElbow(comp, boreUnit, registerMaterial));
          break;
        case 'TEE':
          lines.push(...PcfExporter.serializeTee(comp, boreUnit, registerMaterial));
          break;
        case 'FLANGE':
          lines.push(...PcfExporter.serializeFlange(comp, boreUnit, registerMaterial));
          break;
        case 'VALVE':
          lines.push(...PcfExporter.serializeValve(comp, boreUnit, registerMaterial));
          break;
        case 'REDUCER':
          lines.push(...PcfExporter.serializeReducer(comp, boreUnit, registerMaterial));
          break;
      }
    }

    // Serializar uniones (WELD / GASKET + BOLT) si está habilitado
    if (includeWelds && graph.joints.size > 0) {
      let weldSeq = 1;
      for (const joint of graph.joints.values()) {
        lines.push(
          ...PcfExporter.serializeJoint(
            joint,
            graph,
            boreUnit,
            weldSeq++,
            registerMaterial
          )
        );
      }
    }

    // Sección MATERIALS estándar ISOGEN al pie del archivo
    if (includeMaterials && materialsMap.size > 0) {
      lines.push('MATERIALS');
      for (const [itemCode, description] of materialsMap.entries()) {
        lines.push(`ITEM-CODE ${itemCode}`);
        lines.push(`    DESCRIPTION ${description}`);
      }
      lines.push('');
    }

    return lines.join('\n') + '\n';
  }

  private static serializePipe(
    comp: Component,
    boreUnit: 'INCH' | 'MM',
    seqIndex: number,
    registerMaterial: (code: string, desc: string) => void
  ): string[] {
    if (comp.ports.length < 2) return [];

    const p1 = comp.ports[0];
    const p2 = comp.ports[1];
    const itemCode = comp.catalogId || `PIPE-${comp.specCode}-${Math.round(p1.nominalDiameter * 100)}`;
    const desc =
      comp.parameters.description ||
      `PIPE ASTM A106 GR.B ${comp.parameters.schedule || 'SCH 40'} ${p1.nominalDiameter}"`;
    const wallThick = comp.parameters.wallThickness || p1.wallThickness;
    const nippleTag = comp.parameters.nippleTag || `N-${String(seqIndex).padStart(2, '0')}`;
    const endPrep1 =
      comp.parameters.endFinish1 ||
      (p1.endType === 'THD' ? 'Roscado' : p1.endType === 'SW' ? 'Plano' : 'Bisel');
    const endPrep2 =
      comp.parameters.endFinish2 ||
      (p2.endType === 'THD' ? 'Roscado' : p2.endType === 'SW' ? 'Plano' : 'Bisel');

    registerMaterial(itemCode, desc);

    return [
      'PIPE',
      `    END-POINT ${fmtCoord(p1.position.x)} ${fmtCoord(p1.position.y)} ${fmtCoord(p1.position.z)} ${fmtBore(p1.nominalDiameter, boreUnit)} ${p1.endType}`,
      `    END-POINT ${fmtCoord(p2.position.x)} ${fmtCoord(p2.position.y)} ${fmtCoord(p2.position.z)} ${fmtBore(p2.nominalDiameter, boreUnit)} ${p2.endType}`,
      `    PIPING-SPEC ${comp.specCode}`,
      `    ITEM-CODE ${itemCode}`,
      `    DESCRIPTION ${desc}`,
      `    WALL-THICKNESS ${fmtCoord(wallThick)}`,
      `    SCHEDULE ${comp.parameters.schedule || p1.schedule || 'SCH 40'}`,
      `    TAG ${nippleTag}`,
      `    END-PREPARATION ${endPrep1}/${endPrep2}`,
      `    COMPONENT-IDENTIFIER ${comp.id}`,
      ''
    ];
  }

  private static serializeElbow(
    comp: Component,
    boreUnit: 'INCH' | 'MM',
    registerMaterial: (code: string, desc: string) => void
  ): string[] {
    if (comp.ports.length < 2) return [];

    const p1 = comp.ports[0];
    const p2 = comp.ports[1];
    const angleDeg = comp.parameters.angle || 90;
    const anglePcf = Math.round(angleDeg * 100);

    const takeOff = comp.parameters.takeOff || comp.parameters.radius || 76.2;
    const vertex = p1.position.clone().add(p1.direction.clone().negate().multiplyScalar(takeOff));

    const itemCode = comp.catalogId || `ELB${angleDeg}-${comp.specCode}-${Math.round(p1.nominalDiameter * 100)}`;
    const desc =
      comp.parameters.description ||
      `ELBOW ${angleDeg} LR ASTM A234 WPB ${comp.parameters.schedule || 'SCH 40'} ${p1.nominalDiameter}"`;
    const wallThick = comp.parameters.wallThickness || p1.wallThickness;
    const skey = p1.endType === 'THD' ? 'ELSC' : p1.endType === 'SW' ? 'ELSW' : 'ELBW';

    registerMaterial(itemCode, desc);

    return [
      'ELBOW',
      `    END-POINT ${fmtCoord(p1.position.x)} ${fmtCoord(p1.position.y)} ${fmtCoord(p1.position.z)} ${fmtBore(p1.nominalDiameter, boreUnit)} ${p1.endType}`,
      `    END-POINT ${fmtCoord(p2.position.x)} ${fmtCoord(p2.position.y)} ${fmtCoord(p2.position.z)} ${fmtBore(p2.nominalDiameter, boreUnit)} ${p2.endType}`,
      `    CENTRE-POINT ${fmtCoord(vertex.x)} ${fmtCoord(vertex.y)} ${fmtCoord(vertex.z)}`,
      `    SKEY ${skey}`,
      `    ANGLE ${anglePcf}`,
      `    PIPING-SPEC ${comp.specCode}`,
      `    ITEM-CODE ${itemCode}`,
      `    DESCRIPTION ${desc}`,
      `    WALL-THICKNESS ${fmtCoord(wallThick)}`,
      `    COMPONENT-IDENTIFIER ${comp.id}`,
      ''
    ];
  }

  private static serializeTee(
    comp: Component,
    boreUnit: 'INCH' | 'MM',
    registerMaterial: (code: string, desc: string) => void
  ): string[] {
    if (comp.ports.length < 3) return [];

    const pRun1 = comp.ports[0];
    const pRun2 = comp.ports[1];
    const pBranch = comp.ports[2];

    const center =
      comp.centerline && comp.centerline.length >= 2
        ? comp.centerline[1]
        : pRun1.position.clone().add(pRun2.position).multiplyScalar(0.5);
    const itemCode = comp.catalogId || `TEE-${comp.specCode}-${Math.round(pRun1.nominalDiameter * 100)}`;
    const desc =
      comp.parameters.description ||
      `TEE STRAIGHT ASTM A234 WPB ${comp.parameters.schedule || 'SCH 40'} ${pRun1.nominalDiameter}"`;
    const wallThick = comp.parameters.wallThickness || pRun1.wallThickness;
    const skey = pRun1.endType === 'THD' ? 'TESC' : pRun1.endType === 'SW' ? 'TESW' : 'TEBW';

    registerMaterial(itemCode, desc);

    return [
      'TEE',
      `    END-POINT ${fmtCoord(pRun1.position.x)} ${fmtCoord(pRun1.position.y)} ${fmtCoord(pRun1.position.z)} ${fmtBore(pRun1.nominalDiameter, boreUnit)} ${pRun1.endType}`,
      `    END-POINT ${fmtCoord(pRun2.position.x)} ${fmtCoord(pRun2.position.y)} ${fmtCoord(pRun2.position.z)} ${fmtBore(pRun2.nominalDiameter, boreUnit)} ${pRun2.endType}`,
      `    CENTRE-POINT ${fmtCoord(center.x)} ${fmtCoord(center.y)} ${fmtCoord(center.z)}`,
      `    BRANCH1-POINT ${fmtCoord(pBranch.position.x)} ${fmtCoord(pBranch.position.y)} ${fmtCoord(pBranch.position.z)} ${fmtBore(pBranch.nominalDiameter, boreUnit)} ${pBranch.endType}`,
      `    SKEY ${skey}`,
      `    PIPING-SPEC ${comp.specCode}`,
      `    ITEM-CODE ${itemCode}`,
      `    DESCRIPTION ${desc}`,
      `    WALL-THICKNESS ${fmtCoord(wallThick)}`,
      `    COMPONENT-IDENTIFIER ${comp.id}`,
      ''
    ];
  }

  private static serializeFlange(
    comp: Component,
    boreUnit: 'INCH' | 'MM',
    registerMaterial: (code: string, desc: string) => void
  ): string[] {
    if (comp.ports.length < 2) return [];

    const p1 = comp.ports[0];
    const p2 = comp.ports[1];
    const itemCode = comp.catalogId || `FLG-WN-${comp.specCode}-${Math.round(p1.nominalDiameter * 100)}`;
    const desc = comp.parameters.description || `FLANGE WN RF CL 150 ${p1.nominalDiameter}"`;
    const wallThick = comp.parameters.wallThickness || p1.wallThickness;

    registerMaterial(itemCode, desc);

    return [
      'FLANGE',
      `    END-POINT ${fmtCoord(p1.position.x)} ${fmtCoord(p1.position.y)} ${fmtCoord(p1.position.z)} ${fmtBore(p1.nominalDiameter, boreUnit)} ${p1.endType}`,
      `    END-POINT ${fmtCoord(p2.position.x)} ${fmtCoord(p2.position.y)} ${fmtCoord(p2.position.z)} ${fmtBore(p2.nominalDiameter, boreUnit)} ${p2.endType}`,
      '    SKEY FLWN',
      `    PIPING-SPEC ${comp.specCode}`,
      `    ITEM-CODE ${itemCode}`,
      `    DESCRIPTION ${desc}`,
      `    WALL-THICKNESS ${fmtCoord(wallThick)}`,
      `    COMPONENT-IDENTIFIER ${comp.id}`,
      ''
    ];
  }

  private static serializeValve(
    comp: Component,
    boreUnit: 'INCH' | 'MM',
    registerMaterial: (code: string, desc: string) => void
  ): string[] {
    if (comp.ports.length < 2) return [];

    const p1 = comp.ports[0];
    const p2 = comp.ports[1];
    const center = p1.position.clone().add(p2.position).multiplyScalar(0.5);
    const itemCode = comp.catalogId || `VLV-${comp.specCode}-${Math.round(p1.nominalDiameter * 100)}`;
    const desc = comp.parameters.description || `VALVE GATE CL 150 RF ${p1.nominalDiameter}"`;
    const wallThick = comp.parameters.wallThickness || p1.wallThickness;

    const upperDesc = desc.toUpperCase();
    const skey = upperDesc.includes('GLOBE')
      ? 'VVFL'
      : upperDesc.includes('CHECK') || upperDesc.includes('RETENCION')
      ? 'VCFL'
      : upperDesc.includes('BALL') || upperDesc.includes('ESFERICA')
      ? 'VBFL'
      : 'VGFL';

    registerMaterial(itemCode, desc);

    return [
      'VALVE',
      `    END-POINT ${fmtCoord(p1.position.x)} ${fmtCoord(p1.position.y)} ${fmtCoord(p1.position.z)} ${fmtBore(p1.nominalDiameter, boreUnit)} ${p1.endType}`,
      `    END-POINT ${fmtCoord(p2.position.x)} ${fmtCoord(p2.position.y)} ${fmtCoord(p2.position.z)} ${fmtBore(p2.nominalDiameter, boreUnit)} ${p2.endType}`,
      `    CENTRE-POINT ${fmtCoord(center.x)} ${fmtCoord(center.y)} ${fmtCoord(center.z)}`,
      `    SKEY ${skey}`,
      `    PIPING-SPEC ${comp.specCode}`,
      `    ITEM-CODE ${itemCode}`,
      `    DESCRIPTION ${desc}`,
      `    WALL-THICKNESS ${fmtCoord(wallThick)}`,
      `    COMPONENT-IDENTIFIER ${comp.id}`,
      ''
    ];
  }

  private static serializeReducer(
    comp: Component,
    boreUnit: 'INCH' | 'MM',
    registerMaterial: (code: string, desc: string) => void
  ): string[] {
    if (comp.ports.length < 2) return [];

    const p1 = comp.ports[0];
    const p2 = comp.ports[1];
    const itemCode =
      comp.catalogId ||
      `RED-CON-${comp.specCode}-${Math.round(p1.nominalDiameter * 100)}-${Math.round(p2.nominalDiameter * 100)}`;
    const desc =
      comp.parameters.description ||
      `REDUCER CONC ASTM A234 WPB ${comp.parameters.schedule || 'SCH 40'} ${p1.nominalDiameter}"x${p2.nominalDiameter}"`;
    const wallThick = comp.parameters.wallThickness || p1.wallThickness;

    registerMaterial(itemCode, desc);

    return [
      'REDUCER-CONCENTRIC',
      `    END-POINT ${fmtCoord(p1.position.x)} ${fmtCoord(p1.position.y)} ${fmtCoord(p1.position.z)} ${fmtBore(p1.nominalDiameter, boreUnit)} ${p1.endType}`,
      `    END-POINT ${fmtCoord(p2.position.x)} ${fmtCoord(p2.position.y)} ${fmtCoord(p2.position.z)} ${fmtBore(p2.nominalDiameter, boreUnit)} ${p2.endType}`,
      '    SKEY RCBW',
      `    PIPING-SPEC ${comp.specCode}`,
      `    ITEM-CODE ${itemCode}`,
      `    DESCRIPTION ${desc}`,
      `    WALL-THICKNESS ${fmtCoord(wallThick)}`,
      `    COMPONENT-IDENTIFIER ${comp.id}`,
      ''
    ];
  }

  private static serializeJoint(
    joint: Joint,
    graph: PipingGraph,
    boreUnit: 'INCH' | 'MM',
    weldIndex: number,
    registerMaterial: (code: string, desc: string) => void
  ): string[] {
    const portA = graph.ports.get(joint.portAId);
    const portB = graph.ports.get(joint.portBId);
    const nd = portA?.nominalDiameter || portB?.nominalDiameter || 2;
    const pos = joint.position;

    if (joint.type === 'FLANGED') {
      const compA = portA ? graph.components.get(portA.componentId) : undefined;
      const compB = portB ? graph.components.get(portB.componentId) : undefined;
      const flangeComp = compA?.type === 'FLANGE' ? compA : compB?.type === 'FLANGE' ? compB : compA;

      const gasketDesc =
        flangeComp?.parameters.gasketDescription ||
        `JUNTA ESPIRALADA ASME B16.20 ${nd}"`;
      const boltDesc =
        flangeComp?.parameters.boltSetDescription ||
        `JUEGO ESPARRAGOS ASTM A193 B7 ${nd}"`;
      const boltDia = (flangeComp?.parameters.boltSize || '5/8"').replace('"', '');
      const boltLen = flangeComp?.parameters.boltLengthMm || 90;
      const boltQty = flangeComp?.parameters.boltCount || 4;

      const gskCode = `GSK-${graph.activeSpec}-${Math.round(nd * 100)}`;
      const bltCode = `BLT-${graph.activeSpec}-${Math.round(nd * 100)}`;
      registerMaterial(gskCode, gasketDesc);
      registerMaterial(bltCode, boltDesc);

      return [
        'GASKET',
        `    END-POINT ${fmtCoord(pos.x)} ${fmtCoord(pos.y)} ${fmtCoord(pos.z)} ${fmtBore(nd, boreUnit)}`,
        `    END-POINT ${fmtCoord(pos.x)} ${fmtCoord(pos.y)} ${fmtCoord(pos.z)} ${fmtBore(nd, boreUnit)}`,
        `    ITEM-CODE ${gskCode}`,
        `    DESCRIPTION ${gasketDesc}`,
        '',
        'BOLT',
        `    END-POINT ${fmtCoord(pos.x)} ${fmtCoord(pos.y)} ${fmtCoord(pos.z)} ${fmtBore(nd, boreUnit)}`,
        `    BOLT-DIA ${boltDia}`,
        `    BOLT-LENGTH ${boltLen}`,
        `    BOLT-QUANTITY ${boltQty}`,
        `    ITEM-CODE ${bltCode}`,
        `    DESCRIPTION ${boltDesc}`,
        ''
      ];
    }

    const skey = joint.type === 'SOCKETWELD' ? 'SW' : 'WW';
    return [
      'WELD',
      `    END-POINT ${fmtCoord(pos.x)} ${fmtCoord(pos.y)} ${fmtCoord(pos.z)} ${fmtBore(nd, boreUnit)}`,
      `    END-POINT ${fmtCoord(pos.x)} ${fmtCoord(pos.y)} ${fmtCoord(pos.z)} ${fmtBore(nd, boreUnit)}`,
      `    SKEY ${skey}`,
      `    WELD-REMARK W-${weldIndex}`,
      ''
    ];
  }
}
