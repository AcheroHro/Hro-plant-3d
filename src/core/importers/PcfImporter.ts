import * as THREE from 'three';
import { PipingGraph } from '../graph/PipingGraph';
import { SpecDatabaseReader } from '../specs/SpecDatabaseReader';
import { Component, NippleEndFinish, EndType, Port } from '../../types/piping';
import { calculateElbowPlacement } from '../math/elbowSolver';

interface PcfPoint {
  x: number;
  y: number;
  z: number;
  bore: number;
  endType: EndType;
}

interface PcfBlock {
  type: string;
  endPoints: PcfPoint[];
  centrePoint?: THREE.Vector3;
  branch1Point?: PcfPoint;
  angle?: number;
  itemCode?: string;
  description?: string;
  wallThickness?: number;
  schedule?: string;
  pipingSpec?: string;
  tag?: string;
  endPreparation?: string;
}

/**
 * Normaliza el diámetro nominal leído de un PCF (puede venir en pulgadas ej. 2.00 o en mm DN ej. 50 / 100)
 */
function normalizeNominalDiameter(rawBore: number, boreUnits: 'INCH' | 'MM'): number {
  if (boreUnits === 'MM' || rawBore >= 15) {
    const dnMap: Record<number, number> = {
      15: 0.5,
      20: 0.75,
      25: 1,
      32: 1.25,
      40: 1.5,
      50: 2,
      65: 2.5,
      80: 3,
      90: 3.5,
      100: 4,
      125: 5,
      150: 6,
      200: 8,
      250: 10,
      300: 300 in { 300: 12 } ? 12 : 12
    };
    const rounded = Math.round(rawBore);
    if (dnMap[rounded]) return dnMap[rounded];
    return Number((rawBore / 25.4).toFixed(2));
  }
  return rawBore || 2;
}

function estimateOuterDiameter(ndInches: number): number {
  const odTable: Record<number, number> = {
    0.5: 21.3,
    0.75: 26.7,
    1: 33.4,
    1.25: 42.2,
    1.5: 48.3,
    2: 60.3,
    2.5: 73.0,
    3: 88.9,
    4: 114.3,
    6: 168.3,
    8: 219.1,
    10: 273.1,
    12: 323.9
  };
  return odTable[ndInches] || ndInches * 25.4;
}

/**
 * Importador de archivos PCF (Piping Component File) de AutoCAD Plant 3D / ISOGEN
 * Reconstruye el modelo 3D completo, sus componentes, bocas y lista de cortes de niples.
 */
export class PcfImporter {
  public static importFromPcf(
    pcfContent: string,
    specReader?: SpecDatabaseReader | null,
    activeSpec: string = 'CS150'
  ): { graph: PipingGraph; componentCount: number; pipeCount: number; lineReference: string } {
    const lines = pcfContent.split(/\r?\n/);
    let boreUnits: 'INCH' | 'MM' = 'INCH';
    let detectedSpec = activeSpec;
    let pipelineRef = `100-${activeSpec}-2"`;

    const blocks: PcfBlock[] = [];
    let currentBlock: PcfBlock | null = null;
    let inMaterialsSection = false;
    let currentMaterialCode: string | null = null;
    const materialsCatalog = new Map<string, string>();

    const blockHeaders = new Set([
      'PIPE',
      'ELBOW',
      'BEND',
      'TEE',
      'FLANGE',
      'VALVE',
      'REDUCER',
      'REDUCER-CONCENTRIC',
      'REDUCER-ECCENTRIC',
      'CAP'
    ]);

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;

      const tokens = trimmed.split(/\s+/);
      const keyword = tokens[0].toUpperCase();

      if (keyword === 'UNITS-BORE' && tokens[1]) {
        boreUnits = tokens[1].toUpperCase().startsWith('M') ? 'MM' : 'INCH';
        continue;
      }

      if (keyword === 'PIPELINE-REFERENCE' && tokens.length >= 2) {
        pipelineRef = tokens.slice(1).join(' ');
        continue;
      }

      const isIndented = rawLine.startsWith(' ') || rawLine.startsWith('\t');

      if (!isIndented) {
        if (currentBlock) {
          blocks.push(currentBlock);
          currentBlock = null;
        }
        if (keyword === 'MATERIALS') {
          inMaterialsSection = true;
          currentMaterialCode = null;
          continue;
        }
        if (blockHeaders.has(keyword)) {
          inMaterialsSection = false;
          currentBlock = {
            type: keyword,
            endPoints: []
          };
          continue;
        }
        if (keyword !== 'ITEM-CODE') {
          inMaterialsSection = false;
        }
      }

      if (inMaterialsSection) {
        if (keyword === 'ITEM-CODE' && tokens.length >= 2) {
          currentMaterialCode = tokens.slice(1).join(' ');
        } else if (keyword === 'DESCRIPTION' && currentMaterialCode && tokens.length >= 2) {
          materialsCatalog.set(currentMaterialCode, tokens.slice(1).join(' '));
        }
        continue;
      }

      if (!currentBlock) {
        if (keyword === 'PIPING-SPEC' && tokens[1]) {
          detectedSpec = tokens[1];
        }
        continue;
      }

      if (keyword === 'END-POINT' && tokens.length >= 4) {
        const x = parseFloat(tokens[1]);
        const y = parseFloat(tokens[2]);
        const z = parseFloat(tokens[3]);
        const rawBore = tokens[4] ? parseFloat(tokens[4]) : 2;
        const rawEnd = (tokens[5] || 'BW').toUpperCase();
        const endType: EndType =
          rawEnd === 'FL' || rawEnd === 'FLG' || rawEnd === 'FLANG'
            ? 'FLANG'
            : rawEnd === 'THD' || rawEnd === 'SCRD'
            ? 'THD'
            : rawEnd === 'SW'
            ? 'SW'
            : 'BW';

        if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
          currentBlock.endPoints.push({
            x,
            y,
            z,
            bore: normalizeNominalDiameter(rawBore, boreUnits),
            endType
          });
        }
      } else if (keyword === 'CENTRE-POINT' && tokens.length >= 4) {
        const x = parseFloat(tokens[1]);
        const y = parseFloat(tokens[2]);
        const z = parseFloat(tokens[3]);
        if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
          currentBlock.centrePoint = new THREE.Vector3(x, y, z);
        }
      } else if (keyword === 'BRANCH1-POINT' && tokens.length >= 4) {
        const x = parseFloat(tokens[1]);
        const y = parseFloat(tokens[2]);
        const z = parseFloat(tokens[3]);
        const rawBore = tokens[4] ? parseFloat(tokens[4]) : 2;
        if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
          currentBlock.branch1Point = {
            x,
            y,
            z,
            bore: normalizeNominalDiameter(rawBore, boreUnits),
            endType: 'BW'
          };
        }
      } else if (keyword === 'ANGLE' && tokens[1]) {
        const val = parseFloat(tokens[1]);
        if (!isNaN(val)) {
          currentBlock.angle = val > 360 ? val / 100 : val;
        }
      } else if (keyword === 'ITEM-CODE' && tokens.length >= 2) {
        currentBlock.itemCode = tokens.slice(1).join(' ');
      } else if (keyword === 'DESCRIPTION' && tokens.length >= 2) {
        currentBlock.description = tokens.slice(1).join(' ');
      } else if (keyword === 'WALL-THICKNESS' && tokens[1]) {
        currentBlock.wallThickness = parseFloat(tokens[1]);
      } else if (keyword === 'SCHEDULE' && tokens.length >= 2) {
        currentBlock.schedule = tokens.slice(1).join(' ');
      } else if (keyword === 'PIPING-SPEC' && tokens[1]) {
        currentBlock.pipingSpec = tokens[1];
        detectedSpec = tokens[1];
      } else if (keyword === 'TAG' && tokens.length >= 2) {
        currentBlock.tag = tokens.slice(1).join(' ');
      } else if (keyword === 'END-PREPARATION' && tokens[1]) {
        currentBlock.endPreparation = tokens[1];
      }
    }

    if (currentBlock) blocks.push(currentBlock);

    const firstNd = blocks[0]?.endPoints[0]?.bore || 2;
    const graph = new PipingGraph(detectedSpec, firstNd, 'SCH 40');
    graph.activeLineNumber = pipelineRef;

    let pipeCount = 0;

    for (const blk of blocks) {
      const resolvedDesc =
        blk.description || (blk.itemCode ? materialsCatalog.get(blk.itemCode) : undefined);
      const compSpec = blk.pipingSpec || detectedSpec;

      if (blk.type === 'PIPE' && blk.endPoints.length >= 2) {
        const ep1 = blk.endPoints[0];
        const ep2 = blk.endPoints[1];
        const p1 = new THREE.Vector3(ep1.x, ep1.y, ep1.z);
        const p2 = new THREE.Vector3(ep2.x, ep2.y, ep2.z);
        if (p1.distanceTo(p2) < 1) continue;

        const nd = ep1.bore || 2;
        const specPipe = specReader?.findPipe(nd, compSpec) || {
          pnpid: 1,
          partType: 'PIPE' as const,
          specCode: compSpec,
          shortDescription: resolvedDesc || `PIPE ASTM A106 GR.B SCH 40 ${nd}"`,
          nominalDiameter: nd,
          outerDiameter: estimateOuterDiameter(nd),
          wallThickness: blk.wallThickness || 3.91,
          schedule: blk.schedule || 'SCH 40',
          endType: ep1.endType
        };

        const pipeComp = graph.addPipe(p1, p2, specPipe);
        pipeComp.parameters.lineNumber = pipelineRef;
        if (resolvedDesc) pipeComp.parameters.description = resolvedDesc;
        if (blk.tag) pipeComp.parameters.nippleTag = blk.tag;
        if (blk.endPreparation && blk.endPreparation.includes('/')) {
          const [rawEf1, rawEf2] = blk.endPreparation.split('/');
          const parseFinish = (val: string): NippleEndFinish | undefined => {
            const v = val.trim();
            if (v === 'Bisel' || v === 'BE') return 'Bisel';
            if (v === 'Plano' || v === 'PE') return 'Plano';
            if (v === 'Roscado' || v === 'TE') return 'Roscado';
            return undefined;
          };
          const ef1 = parseFinish(rawEf1);
          const ef2 = parseFinish(rawEf2);
          if (ef1) pipeComp.parameters.endFinish1 = ef1;
          if (ef2) pipeComp.parameters.endFinish2 = ef2;
        }
        pipeCount++;
      } else if ((blk.type === 'ELBOW' || blk.type === 'BEND') && blk.endPoints.length >= 2) {
        const ep1 = blk.endPoints[0];
        const ep2 = blk.endPoints[1];
        const p1 = new THREE.Vector3(ep1.x, ep1.y, ep1.z);
        const p2 = new THREE.Vector3(ep2.x, ep2.y, ep2.z);
        const nd = ep1.bore || 2;
        const od = estimateOuterDiameter(nd);
        const wt = blk.wallThickness || 3.91;

        const vertex =
          blk.centrePoint || p1.clone().add(p2).multiplyScalar(0.5);
        const takeOff = Math.max(20, p1.distanceTo(vertex));
        const uIn = new THREE.Vector3().subVectors(vertex, p1).normalize();
        const uOut = new THREE.Vector3().subVectors(p2, vertex).normalize();
        const pStart = vertex.clone().sub(uIn.clone().multiplyScalar(takeOff * 2));
        const pNext = vertex.clone().add(uOut.clone().multiplyScalar(takeOff * 2));

        try {
          const placement = calculateElbowPlacement(pStart, vertex, pNext, takeOff);
          const elbowSpec = specReader?.findElbow(nd, Math.round(placement.bendAngleDeg), compSpec) || {
            pnpid: 2,
            partType: 'ELBOW' as const,
            specCode: compSpec,
            shortDescription: resolvedDesc || `ELBOW ${Math.round(placement.bendAngleDeg)} LR ${nd}"`,
            nominalDiameter: nd,
            outerDiameter: od,
            wallThickness: wt,
            schedule: blk.schedule || 'SCH 40',
            endType: ep1.endType,
            angle: Math.round(placement.bendAngleDeg),
            radius: takeOff,
            takeOff
          };
          const elb = graph.addElbow(placement, elbowSpec);
          elb.parameters.lineNumber = pipelineRef;
          if (resolvedDesc) elb.parameters.description = resolvedDesc;
        } catch {
          // Si los puntos son colineales en un PCF mal formado, ignorar giro
        }
      } else if (blk.type === 'TEE' && blk.endPoints.length >= 2) {
        const ep1 = blk.endPoints[0];
        const ep2 = blk.endPoints[1];
        const p1 = new THREE.Vector3(ep1.x, ep1.y, ep1.z);
        const p2 = new THREE.Vector3(ep2.x, ep2.y, ep2.z);
        const vertex = blk.centrePoint || p1.clone().add(p2).multiplyScalar(0.5);
        const p3 = blk.branch1Point
          ? new THREE.Vector3(blk.branch1Point.x, blk.branch1Point.y, blk.branch1Point.z)
          : vertex.clone().add(new THREE.Vector3(0, 0, 63.5));

        const nd = ep1.bore || 2;
        const od = estimateOuterDiameter(nd);
        const wt = blk.wallThickness || 3.91;
        const uRun = new THREE.Vector3().subVectors(p2, p1).normalize();
        const uBranch = new THREE.Vector3().subVectors(p3, vertex).normalize();

        const compId = `tee_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const port1: Port = {
          id: `${compId}_p1`,
          componentId: compId,
          index: 1,
          position: p1,
          direction: uRun.clone().negate(),
          nominalDiameter: nd,
          outerDiameter: od,
          wallThickness: wt,
          schedule: blk.schedule || 'SCH 40',
          endType: ep1.endType
        };
        const port2: Port = {
          id: `${compId}_p2`,
          componentId: compId,
          index: 2,
          position: p2,
          direction: uRun.clone(),
          nominalDiameter: nd,
          outerDiameter: od,
          wallThickness: wt,
          schedule: blk.schedule || 'SCH 40',
          endType: ep2.endType
        };
        const port3: Port = {
          id: `${compId}_p3`,
          componentId: compId,
          index: 3,
          position: p3,
          direction: uBranch,
          nominalDiameter: blk.branch1Point?.bore || nd,
          outerDiameter: od,
          wallThickness: wt,
          schedule: blk.schedule || 'SCH 40',
          endType: 'BW'
        };

        const teeComp: Component = {
          id: compId,
          type: 'TEE',
          specCode: compSpec,
          catalogId: blk.itemCode || 'TEE',
          ports: [port1, port2, port3],
          centerline: [p1.clone(), vertex.clone(), p2.clone(), p3.clone()],
          parameters: {
            nominalDiameter: nd,
            outerDiameter: od,
            wallThickness: wt,
            schedule: blk.schedule || 'SCH 40',
            runTakeOff: p1.distanceTo(vertex) || 63.5,
            branchTakeOff: vertex.distanceTo(p3) || 63.5,
            description: resolvedDesc || `TEE STRAIGHT ASTM A234 WPB ${nd}"`,
            lineNumber: pipelineRef
          }
        };
        graph.addComponent(teeComp);
      } else if (
        (blk.type === 'FLANGE' ||
          blk.type === 'VALVE' ||
          blk.type === 'REDUCER' ||
          blk.type === 'REDUCER-CONCENTRIC' ||
          blk.type === 'REDUCER-ECCENTRIC') &&
        blk.endPoints.length >= 2
      ) {
        const ep1 = blk.endPoints[0];
        const ep2 = blk.endPoints[1];
        const p1 = new THREE.Vector3(ep1.x, ep1.y, ep1.z);
        const p2 = new THREE.Vector3(ep2.x, ep2.y, ep2.z);
        const uDir = new THREE.Vector3().subVectors(p2, p1).normalize();
        const nd1 = ep1.bore || 2;
        const nd2 = ep2.bore || nd1;
        const od1 = estimateOuterDiameter(nd1);
        const od2 = estimateOuterDiameter(nd2);
        const wt = blk.wallThickness || 3.91;

        const compType = blk.type.startsWith('REDUCER')
          ? 'REDUCER'
          : blk.type === 'VALVE'
          ? 'VALVE'
          : 'FLANGE';

        const compId = `${compType.toLowerCase()}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const port1: Port = {
          id: `${compId}_p1`,
          componentId: compId,
          index: 1,
          position: p1,
          direction: uDir.clone().negate(),
          nominalDiameter: nd1,
          outerDiameter: od1,
          wallThickness: wt,
          schedule: blk.schedule || 'SCH 40',
          endType: ep1.endType
        };
        const port2: Port = {
          id: `${compId}_p2`,
          componentId: compId,
          index: 2,
          position: p2,
          direction: uDir.clone(),
          nominalDiameter: nd2,
          outerDiameter: od2,
          wallThickness: wt,
          schedule: blk.schedule || 'SCH 40',
          endType: ep2.endType
        };

        const comp: Component = {
          id: compId,
          type: compType,
          specCode: compSpec,
          catalogId: blk.itemCode || compType,
          ports: [port1, port2],
          centerline: [p1.clone(), p2.clone()],
          parameters: {
            nominalDiameter: nd1,
            outerDiameter: od1,
            reducedNominalDiameter: nd2 !== nd1 ? nd2 : undefined,
            reducedOuterDiameter: nd2 !== nd1 ? od2 : undefined,
            wallThickness: wt,
            schedule: blk.schedule || 'SCH 40',
            faceToFace: p1.distanceTo(p2),
            description: resolvedDesc || `${compType} ND ${nd1}"`,
            lineNumber: pipelineRef
          }
        };
        graph.addComponent(comp);
      }
    }

    // Conectar automáticamente todos los puertos que coinciden espacialmente (tolerancia <= 1.0 mm)
    const allPorts = Array.from(graph.ports.values());
    for (let i = 0; i < allPorts.length; i++) {
      const pA = allPorts[i];
      if (pA.connectedJointId) continue;
      for (let j = i + 1; j < allPorts.length; j++) {
        const pB = allPorts[j];
        if (pB.connectedJointId || pB.componentId === pA.componentId) continue;
        if (pA.position.distanceTo(pB.position) <= 1.0 && pA.direction.dot(pB.direction) < -0.95) {
          try {
            const jType = pA.endType === 'FLANG' || pB.endType === 'FLANG' ? 'FLANGED' : 'BUTTWELD';
            graph.connectPorts(pA.id, pB.id, jType);
            break;
          } catch {
            // Ignorar si no pueden unirse
          }
        }
      }
    }

    return {
      graph,
      componentCount: graph.components.size,
      pipeCount,
      lineReference: pipelineRef
    };
  }
}
