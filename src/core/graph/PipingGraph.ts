import * as THREE from 'three';
import {
  Component,
  ComponentType,
  Joint,
  JointType,
  Port,
  SpecFitting,
  SerializedGraphState,
  SerializedComponent,
  SerializedJoint,
  SerializedPort,
  ElbowPlacementResult,
  PcfGraphInfo,
  FieldWeldKind,
  NippleEndFinish,
  SupportKind,
  SupportMark
} from '../../types/piping';
import { calculateElbowPlacement, validateOpposedPorts, EPSILON } from '../math/elbowSolver';
import { ConnectionRule, DEFAULT_CONNECTION_RULES, resolveConnection } from '../specs/connectionRules';
import { plantEndToAppEnd } from '../specs/units';

/** Extremos de Plant que son cara de brida (se unen con junta y bulones) */
const FACE_ENDS = new Set(['FL', 'LFL', 'WF', 'LUG']);

export function isFaceEnd(port: Pick<Port, 'plantEndType' | 'endType'> | undefined): boolean {
  if (!port) return false;
  if (port.plantEndType) return FACE_ENDS.has(port.plantEndType.toUpperCase());
  return port.endType === 'FLANG';
}

export interface GraphCommand {
  description: string;
  execute: () => void;
  undo: () => void;
}

/**
 * Grafo Topológico No Dirigido de Cañerías (PipingGraph)
 * Administra componentes (nodos), puertos de anclaje polar y juntas de conexión (aristas).
 */
export class PipingGraph {
  public components: Map<string, Component> = new Map();
  public joints: Map<string, Joint> = new Map();
  public ports: Map<string, Port> = new Map();

  public activeSpec: string = 'CS150';
  public currentNominalDiameter: number = 2;
  public currentSchedule: string = 'SCH 40';
  public activeLineNumber: string = '100-CS150-2"';
  /** Reglas de unión de Plant (DefaultConnectorsConfig.xml del proyecto) */
  public connectionRules: ConnectionRule[] = DEFAULT_CONNECTION_RULES;
  /** Cabecera y unidades del PCF importado (para reexportarlo igual) */
  public pcfInfo?: PcfGraphInfo;
  /** Soportes marcados sobre los caños (no son piezas del grafo: no tienen bocas) */
  public supports: Map<string, SupportMark> = new Map();

  private undoStack: GraphCommand[] = [];
  private redoStack: GraphCommand[] = [];

  constructor(specCode: string = 'CS150', nominalDiameter: number = 2, schedule: string = 'SCH 40') {
    this.activeSpec = specCode;
    this.currentNominalDiameter = nominalDiameter;
    this.currentSchedule = schedule;
  }

  /**
   * Genera un identificador único seguro
   */
  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  /** Arma un puerto tomando diámetro, OD y extremo del puerto Sn de la pieza de spec */
  public portFromSpec(
    componentId: string,
    index: number,
    position: THREE.Vector3,
    direction: THREE.Vector3,
    spec: SpecFitting,
    specPortIndex: number
  ): Port {
    const plantEnd = spec.plantEndTypes?.[specPortIndex];
    return {
      id: this.generateId('prt'),
      componentId,
      index,
      position: position.clone(),
      direction: direction.clone().normalize(),
      nominalDiameter: spec.portNominalDiameters?.[specPortIndex] ?? spec.nominalDiameter,
      outerDiameter: spec.portOuterDiameters?.[specPortIndex] || spec.outerDiameter,
      wallThickness: spec.wallThickness,
      schedule: spec.schedule,
      endType: plantEnd ? plantEndToAppEnd(plantEnd) : spec.endType,
      plantEndType: plantEnd,
      pressureClass: spec.pressureClass
    };
  }

  /** Datos de la pieza de spec que viajan con el componente (para PCF, BOM y avisos) */
  public specParameters(spec: SpecFitting): Partial<Component['parameters']> {
    return {
      itemCode: spec.itemCode,
      skey: spec.skey,
      familyId: spec.familyId,
      familyDescription: spec.familyDescription,
      pressureClass: spec.pressureClass,
      geometryConfidence: spec.geometryConfidence,
      geometryNote: spec.geometryNote,
      visual: spec.visual
    };
  }

  /** Unión entre dos puertos según las reglas de Plant (o por tipo de extremo si no hay datos de Plant) */
  public resolveJoint(a: Port, b: Port): { jointType: JointType; plantJoint?: string; problems: string[] } {
    if (a.plantEndType && b.plantEndType) {
      const r = resolveConnection(
        { endType: a.plantEndType, nominalDiameter: a.nominalDiameter, pressureClass: a.pressureClass },
        { endType: b.plantEndType, nominalDiameter: b.nominalDiameter, pressureClass: b.pressureClass },
        this.connectionRules
      );
      return { jointType: r.jointType, plantJoint: r.rule?.name, problems: r.problems };
    }
    if (a.endType === 'FLANG' && b.endType === 'FLANG') return { jointType: 'FLANGED', problems: [] };
    if (a.endType === 'SW' || b.endType === 'SW') return { jointType: 'SOCKETWELD', problems: [] };
    if (a.endType === 'THD' || b.endType === 'THD') return { jointType: 'THREADED', problems: [] };
    return { jointType: 'BUTTWELD', problems: [] };
  }

  /**
   * Agrega un componente al grafo registrando sus puertos
   */
  public addComponent(component: Component): void {
    this.components.set(component.id, component);
    for (const port of component.ports) {
      this.ports.set(port.id, port);
    }
  }

  /**
   * Elimina un componente y desvincula sus juntas
   */
  public removeComponent(componentId: string): Component | undefined {
    const comp = this.components.get(componentId);
    if (!comp) return undefined;

    // Eliminar juntas asociadas a sus puertos
    for (const port of comp.ports) {
      if (port.connectedJointId) {
        this.removeJoint(port.connectedJointId);
      }
      this.ports.delete(port.id);
    }

    this.components.delete(componentId);
    return comp;
  }

  /**
   * Conecta dos puertos polares mediante una junta (Joint), validando alineación opuesta
   */
  public connectPorts(portAId: string, portBId: string, jointType?: JointType, opts: { gapMm?: number } = {}): Joint {
    const portA = this.ports.get(portAId);
    const portB = this.ports.get(portBId);

    if (!portA || !portB) {
      throw new Error(`Uno o ambos puertos no existen: ${portAId}, ${portBId}`);
    }

    if (portA.connectedJointId || portB.connectedJointId) {
      throw new Error(`Uno de los puertos ya está conectado a otra junta.`);
    }

    // Validación de coincidencia espacial (en milímetros); entre bridas queda el espesor de la junta
    const gap = opts.gapMm ?? 0;
    const dist = portA.position.distanceTo(portB.position);
    if (Math.abs(dist - gap) > 1.0) {
      throw new Error(
        `Los puertos no coinciden en posición espacial: distancia = ${dist.toFixed(2)} mm (esperado ${gap.toFixed(2)} mm ± 1 mm).`
      );
    }

    // Validación de normales opuestas (u1 · u2 ≈ -1)
    if (!validateOpposedPorts(portA.direction, portB.direction, 5.0)) {
      throw new Error(
        `Los puertos no están enfrentados en dirección opuesta (u1 · u2 = ${portA.direction.dot(portB.direction).toFixed(3)}).`
      );
    }

    const resolved = this.resolveJoint(portA, portB);
    const jointId = this.generateId('jnt');
    const joint: Joint = {
      id: jointId,
      type: jointType ?? resolved.jointType,
      portAId: portA.id,
      portBId: portB.id,
      position: portA.position.clone().lerp(portB.position, 0.5),
      gapMm: gap > 0 ? gap : undefined,
      plantJoint: resolved.plantJoint
    };

    this.joints.set(joint.id, joint);
    portA.connectedJointId = joint.id;
    portB.connectedJointId = joint.id;

    return joint;
  }

  /**
   * Elimina una junta y libera los puertos
   */
  public removeJoint(jointId: string): void {
    const joint = this.joints.get(jointId);
    if (!joint) return;

    const portA = this.ports.get(joint.portAId);
    if (portA) portA.connectedJointId = undefined;

    const portB = this.ports.get(joint.portBId);
    if (portB) portB.connectedJointId = undefined;

    this.joints.delete(jointId);
  }

  /**
   * Crea un tramo de cañería recta entre dos puntos con sus puertos polarizados
   */
  public addPipe(
    start: THREE.Vector3,
    end: THREE.Vector3,
    fittingSpec: SpecFitting,
    customCutLength?: number
  ): Component {
    const length = start.distanceTo(end);
    if (length < EPSILON) {
      throw new Error('No se puede crear una cañería de longitud cero.');
    }

    const compId = this.generateId('pipe');
    const port1Id = this.generateId('prt');
    const port2Id = this.generateId('prt');

    // Vector dirección desde start hacia end
    const forward = new THREE.Vector3().subVectors(end, start).normalize();
    // Port 1 apunta hacia atrás (hacia afuera del caño desde start)
    const dir1 = forward.clone().negate();
    // Port 2 apunta hacia adelante (hacia afuera del caño desde end)
    const dir2 = forward.clone();

    const port1: Port = { ...this.portFromSpec(compId, 1, start, dir1, fittingSpec, 0), id: port1Id };
    const port2: Port = { ...this.portFromSpec(compId, 2, end, dir2, fittingSpec, 1), id: port2Id };

    const component: Component = {
      id: compId,
      type: 'PIPE',
      specCode: fittingSpec.specCode,
      catalogId: String(fittingSpec.pnpid),
      ports: [port1, port2],
      centerline: [start.clone(), end.clone()],
      parameters: {
        nominalDiameter: fittingSpec.nominalDiameter,
        outerDiameter: fittingSpec.outerDiameter,
        wallThickness: fittingSpec.wallThickness,
        schedule: fittingSpec.schedule,
        grossLength: length,
        cutLength: customCutLength !== undefined ? customCutLength : length,
        description: fittingSpec.shortDescription,
        ...this.specParameters(fittingSpec)
      }
    };

    this.addComponent(component);
    return component;
  }

  /**
   * Crea un componente de codo en base al resultado geométrico de colocación
   */
  public addElbow(
    placement: ElbowPlacementResult,
    elbowSpec: SpecFitting
  ): Component {
    const compId = this.generateId('elbow');
    const port1Id = this.generateId('prt');
    const port2Id = this.generateId('prt');

    // Puerto 1 en cutPoint1: su normal exterior apunta hacia la cañería entrante (-uIn = basisX)
    const dir1 = placement.basisX.clone();
    // Puerto 2 en cutPoint2: su normal exterior apunta hacia la cañería saliente (uOut)
    const dir2 = new THREE.Vector3().subVectors(placement.cutPoint2, placement.vertex).normalize();

    const port1: Port = { ...this.portFromSpec(compId, 1, placement.cutPoint1, dir1, elbowSpec, 0), id: port1Id };
    const port2: Port = { ...this.portFromSpec(compId, 2, placement.cutPoint2, dir2, elbowSpec, 1), id: port2Id };

    const component: Component = {
      id: compId,
      type: 'ELBOW',
      specCode: elbowSpec.specCode,
      catalogId: String(elbowSpec.pnpid),
      ports: [port1, port2],
      centerline: placement.centerline.map(p => p.clone()),
      parameters: {
        nominalDiameter: elbowSpec.nominalDiameter,
        outerDiameter: elbowSpec.outerDiameter,
        wallThickness: elbowSpec.wallThickness,
        schedule: elbowSpec.schedule,
        angle: placement.bendAngleDeg,
        radius: elbowSpec.radius || elbowSpec.takeOff,
        takeOff: elbowSpec.takeOff,
        description: elbowSpec.shortDescription,
        matrixElements: Array.from(placement.matrix.elements),
        ...this.specParameters(elbowSpec)
      }
    };

    this.addComponent(component);
    return component;
  }

  /**
   * Rutea una intersección con giro insertando el codo y recortando exactamente
   * las cañerías entrante y saliente por su cota de take-off.
   */
  public routeTurnWithElbow(
    pStart: THREE.Vector3,
    vertex: THREE.Vector3,
    pNext: THREE.Vector3,
    pipeSpec: SpecFitting,
    elbowSpec: SpecFitting
  ): {
    incomingPipe: Component;
    elbow: Component;
    outgoingPipe: Component;
    placement: ElbowPlacementResult;
    jointIn: Joint;
    jointOut: Joint;
  } {
    const takeOff = elbowSpec.takeOff || elbowSpec.radius;
    if (!takeOff || takeOff <= 0) {
      throw new Error(`El accesorio codo PnPID ${elbowSpec.pnpid} no posee cota de take-off válida.`);
    }

    // 1. Resolver colocación y recortes
    const placement = calculateElbowPlacement(pStart, vertex, pNext, takeOff, elbowSpec.radius);

    // 2. Crear cañería entrante: desde pStart hasta cutPoint1
    // Longitud neta = placement.netLengthIncoming (Lgross - takeOff)
    const incomingPipe = this.addPipe(pStart, placement.cutPoint1, pipeSpec, placement.netLengthIncoming);

    // 3. Crear accesorio codo entre cutPoint1 y cutPoint2
    const elbow = this.addElbow(placement, elbowSpec);

    // 4. Crear cañería saliente: desde cutPoint2 hasta pNext
    // Longitud neta = placement.netLengthOutgoing (Lgross - takeOff)
    const outgoingPipe = this.addPipe(placement.cutPoint2, pNext, pipeSpec, placement.netLengthOutgoing);

    // 5. Unir cañería entrante (puerto 2) con codo (puerto 1)
    const jointIn = this.connectPorts(incomingPipe.ports[1].id, elbow.ports[0].id);

    // 6. Unir codo (puerto 2) con cañería saliente (puerto 1)
    const jointOut = this.connectPorts(elbow.ports[1].id, outgoingPipe.ports[0].id);

    return {
      incomingPipe,
      elbow,
      outgoingPipe,
      placement,
      jointIn,
      jointOut
    };
  }

  /**
   * Inserta una brida en un puerto abierto, orientada como en Plant 3D:
   * - si el puerto es un caño o accesorio, la brida entra por su lado caño (S2) y queda la cara libre;
   * - si el puerto es una cara (otra brida o una válvula bridada), entra cara contra cara dejando
   *   el espesor de la junta, y queda libre el lado caño.
   */
  public addFlange(
    port: Port,
    flangeSpec: SpecFitting,
    gasketSpec?: SpecFitting | null,
    boltSetSpec?: SpecFitting | null
  ): Component {
    const compId = this.generateId('flg');
    const span = flangeSpec.faceToFace || 63.5;
    const faceFirst = isFaceEnd(port);
    const gap = faceFirst ? gasketSpec?.gasketThicknessMm ?? 0 : 0;
    const dir = port.direction.clone().normalize();

    const p1 = port.position.clone().addScaledVector(dir, gap);
    const p2 = p1.clone().addScaledVector(dir, span);
    // En la spec de Plant S1 es la cara (FL) y S2 el lado caño
    const port1 = this.portFromSpec(compId, 1, p1, dir.clone().negate(), flangeSpec, faceFirst ? 0 : 1);
    const port2 = this.portFromSpec(compId, 2, p2, dir, flangeSpec, faceFirst ? 1 : 0);
    if (!flangeSpec.plantEndTypes) {
      port1.endType = faceFirst ? 'FLANG' : flangeSpec.endType;
      port2.endType = faceFirst ? flangeSpec.endType : 'FLANG';
    }

    const nd = flangeSpec.nominalDiameter;
    const defaultBoltCount = boltSetSpec?.boltCount || flangeSpec.boltHoles || (nd >= 4 ? 8 : 4);
    const defaultBoltSize = boltSetSpec?.boltSize || (nd >= 4 ? '5/8"' : '1/2"');

    const component: Component = {
      id: compId,
      type: 'FLANGE',
      specCode: flangeSpec.specCode,
      catalogId: String(flangeSpec.pnpid),
      ports: [port1, port2],
      centerline: [p1.clone(), p2.clone()],
      parameters: {
        nominalDiameter: nd,
        outerDiameter: flangeSpec.outerDiameter,
        wallThickness: flangeSpec.wallThickness,
        schedule: flangeSpec.schedule,
        faceToFace: span,
        boltCircle: flangeSpec.boltCircle || flangeSpec.outerDiameter * 1.3,
        boltHoles: defaultBoltCount,
        description: flangeSpec.shortDescription,
        gasketDescription: gasketSpec?.shortDescription,
        gasketThicknessMm: gasketSpec?.gasketThicknessMm,
        boltSetDescription: boltSetSpec?.shortDescription,
        boltSize: defaultBoltSize,
        boltCount: defaultBoltCount,
        boltLengthMm: boltSetSpec?.boltLengthMm,
        ...this.specParameters(flangeSpec)
      }
    };

    this.addComponent(component);
    this.connectPorts(port.id, port1.id, undefined, { gapMm: gap });
    return component;
  }

  /**
   * Inserta una válvula en un puerto abierto. Si los dos lados son caras de brida deja el
   * espesor de la junta; la junta y los bulones salen de la unión, no de la válvula.
   */
  public addValve(
    port: Port,
    valveSpec: SpecFitting,
    gasketSpec?: SpecFitting | null,
    boltSetSpec?: SpecFitting | null
  ): Component {
    const compId = this.generateId('vlv');
    const span = valveSpec.faceToFace || 178.0;
    const dir = port.direction.clone().normalize();
    const valveFace = valveSpec.plantEndTypes ? isFaceEnd({ plantEndType: valveSpec.plantEndTypes[0], endType: valveSpec.endType }) : true;
    const gap = valveFace && isFaceEnd(port) ? gasketSpec?.gasketThicknessMm ?? 0 : 0;

    const p1 = port.position.clone().addScaledVector(dir, gap);
    const p2 = p1.clone().addScaledVector(dir, span);
    const port1 = this.portFromSpec(compId, 1, p1, dir.clone().negate(), valveSpec, 0);
    const port2 = this.portFromSpec(compId, 2, p2, dir, valveSpec, 1);
    if (!valveSpec.plantEndTypes) {
      port1.endType = 'FLANG';
      port2.endType = 'FLANG';
    }

    const nd = valveSpec.nominalDiameter;
    const defaultBoltCount = boltSetSpec?.boltCount || valveSpec.boltHoles || (nd >= 4 ? 8 : 4);
    const defaultBoltSize = boltSetSpec?.boltSize || (nd >= 4 ? '5/8"' : '1/2"');

    const component: Component = {
      id: compId,
      type: 'VALVE',
      specCode: valveSpec.specCode,
      catalogId: String(valveSpec.pnpid),
      ports: [port1, port2],
      centerline: [p1.clone(), p2.clone()],
      parameters: {
        nominalDiameter: nd,
        outerDiameter: valveSpec.outerDiameter,
        wallThickness: valveSpec.wallThickness,
        schedule: valveSpec.schedule,
        faceToFace: span,
        boltCircle: valveSpec.boltCircle || valveSpec.outerDiameter * 1.3,
        boltHoles: valveFace ? defaultBoltCount : undefined,
        description: valveSpec.shortDescription,
        gasketDescription: valveFace ? gasketSpec?.shortDescription : undefined,
        gasketThicknessMm: valveFace ? gasketSpec?.gasketThicknessMm : undefined,
        boltSetDescription: valveFace ? boltSetSpec?.shortDescription : undefined,
        boltSize: valveFace ? defaultBoltSize : undefined,
        boltCount: valveFace ? defaultBoltCount : undefined,
        boltLengthMm: valveFace ? boltSetSpec?.boltLengthMm : undefined,
        ...this.specParameters(valveSpec)
      }
    };

    this.addComponent(component);
    this.connectPorts(port.id, port1.id, undefined, { gapMm: gap });
    return component;
  }

  /**
   * Válvula con lo que necesita para quedar montada. Si es de caras (bridada, wafer o lug) y hay
   * brida de la spec, entran brida + junta antes (cuando la boca es de caño) y junta + brida
   * después, como el AutoFlange de Plant 3D. Devuelve la boca por donde sigue la línea.
   */
  public addValveAssembly(
    port: Port,
    valveSpec: SpecFitting,
    options: { flangeSpec?: SpecFitting | null; gasketSpec?: SpecFitting | null; boltSetSpec?: SpecFitting | null } = {}
  ): { valve: Component; flanges: Component[]; outPort: Port } {
    const { flangeSpec, gasketSpec, boltSetSpec } = options;
    const valveFace = valveSpec.plantEndTypes
      ? isFaceEnd({ plantEndType: valveSpec.plantEndTypes[0], endType: valveSpec.endType })
      : valveSpec.endType === 'FLANG';
    const flanges: Component[] = [];
    let inPort = port;
    if (valveFace && flangeSpec && !isFaceEnd(port)) {
      const before = this.addFlange(port, flangeSpec, gasketSpec, boltSetSpec);
      flanges.push(before);
      inPort = before.ports[1];
    }
    const valve = this.addValve(inPort, valveSpec, gasketSpec, boltSetSpec);
    let outPort = valve.ports[1];
    if (valveFace && flangeSpec) {
      const after = this.addFlange(outPort, flangeSpec, gasketSpec, boltSetSpec);
      flanges.push(after);
      outPort = after.ports[1];
    }
    return { valve, flanges, outPort };
  }

  /**
   * Inserta una Te en un puerto abierto garantizando 90° en la derivación.
   * Si la pieza de spec es reductora, el ramal toma su diámetro y OD reales (puerto S3).
   */
  public addTee(port: Port, branchDir: THREE.Vector3, teeSpec: SpecFitting): Component {
    const compId = this.generateId('tee');

    const C = teeSpec.runTakeOff || 63.5;
    const M = teeSpec.branchTakeOff || 63.5;

    const uRun = port.direction.clone().normalize();
    const p1 = port.position.clone();
    const vertex = p1.clone().add(uRun.clone().multiplyScalar(C));
    const p2 = vertex.clone().add(uRun.clone().multiplyScalar(C));

    // Proyectar branchDir en el plano perpendicular a uRun para asegurar 90° exactos
    let bDir = branchDir.clone().addScaledVector(uRun, -branchDir.dot(uRun));
    if (bDir.lengthSq() < 0.01) {
      const fallback = Math.abs(uRun.z) < 0.8 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
      bDir = fallback.addScaledVector(uRun, -fallback.dot(uRun));
    }
    bDir.normalize();
    const p3 = vertex.clone().add(bDir.clone().multiplyScalar(M));

    const port1 = this.portFromSpec(compId, 1, p1, uRun.clone().negate(), teeSpec, 0);
    const port2 = this.portFromSpec(compId, 2, p2, uRun, teeSpec, 1);
    const port3 = this.portFromSpec(compId, 3, p3, bDir, teeSpec, 2);

    const component: Component = {
      id: compId,
      type: 'TEE',
      specCode: teeSpec.specCode,
      catalogId: String(teeSpec.pnpid),
      ports: [port1, port2, port3],
      centerline: [p1.clone(), vertex.clone(), p2.clone(), p3.clone()],
      parameters: {
        nominalDiameter: teeSpec.nominalDiameter,
        outerDiameter: teeSpec.outerDiameter,
        wallThickness: teeSpec.wallThickness,
        schedule: teeSpec.schedule,
        runTakeOff: C,
        branchTakeOff: M,
        reducedNominalDiameter: teeSpec.reducedNominalDiameter,
        reducedOuterDiameter: teeSpec.reducedOuterDiameter,
        description: teeSpec.shortDescription,
        ...this.specParameters(teeSpec)
      }
    };

    this.addComponent(component);
    this.connectPorts(port.id, port1.id);
    return component;
  }

  /**
   * Obtiene mediante búsqueda en anchura (BFS) todos los componentes y juntas conectados
   * aguas abajo a partir de un puerto de salida, sin retroceder hacia blockedComponentId.
   */
  public getDownstreamSubgraph(
    startPortId: string,
    blockedComponentId: string
  ): { componentIds: Set<string>; jointIds: Set<string> } {
    const componentIds = new Set<string>();
    const jointIds = new Set<string>();
    const startPort = this.ports.get(startPortId);
    if (!startPort || !startPort.connectedJointId) {
      return { componentIds, jointIds };
    }

    const queue: string[] = [startPort.connectedJointId];
    while (queue.length > 0) {
      const jId = queue.shift()!;
      if (jointIds.has(jId)) continue;
      const joint = this.joints.get(jId);
      if (!joint) continue;
      jointIds.add(jId);

      for (const pId of [joint.portAId, joint.portBId]) {
        const p = this.ports.get(pId);
        if (!p || p.componentId === blockedComponentId) continue;
        if (!componentIds.has(p.componentId)) {
          componentIds.add(p.componentId);
          const comp = this.components.get(p.componentId);
          if (comp) {
            for (const otherPort of comp.ports) {
              if (otherPort.connectedJointId && !jointIds.has(otherPort.connectedJointId)) {
                queue.push(otherPort.connectedJointId);
              }
            }
            // Los olets e injertos apoyados en un caño viajan con él, y con ellos su ramal
            for (const olet of this.oletsOn(comp)) {
              if (olet.id === blockedComponentId || componentIds.has(olet.id)) continue;
              componentIds.add(olet.id);
              for (const op of olet.ports) {
                if (op.connectedJointId && !jointIds.has(op.connectedJointId)) queue.push(op.connectedJointId);
              }
            }
          }
        }
      }
    }

    return { componentIds, jointIds };
  }

  /**
   * Traslada rígidamente todo el subgrafo conectado aguas abajo de un puerto en un vector delta (como AutoCAD Plant 3D)
   */
  public translateDownstream(startPortId: string, blockedComponentId: string, delta: THREE.Vector3): void {
    if (delta.lengthSq() < 1e-8) return;
    const { componentIds, jointIds } = this.getDownstreamSubgraph(startPortId, blockedComponentId);
    for (const s of this.supportsOnComponents(componentIds)) s.position.add(delta);

    for (const compId of componentIds) {
      const comp = this.components.get(compId);
      if (!comp) continue;
      for (const p of comp.ports) {
        p.position.add(delta);
      }
      for (const pt of comp.centerline) {
        pt.add(delta);
      }
      if (comp.parameters.matrixElements && comp.parameters.matrixElements.length === 16) {
        const mat = new THREE.Matrix4().fromArray(comp.parameters.matrixElements);
        const pos = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        const scl = new THREE.Vector3();
        mat.decompose(pos, quat, scl);
        pos.add(delta);
        mat.compose(pos, quat, scl);
        comp.parameters.matrixElements = Array.from(mat.elements);
      }
    }

    for (const jId of jointIds) {
      const joint = this.joints.get(jId);
      if (joint) {
        joint.position.add(delta);
      }
    }
  }

  /**
   * Rota rígidamente todo el subgrafo conectado aguas abajo de un puerto alrededor de un eje (pivot, axis, angleRad)
   */
  public rotateDownstream(
    startPortId: string,
    blockedComponentId: string,
    pivot: THREE.Vector3,
    axis: THREE.Vector3,
    angleRad: number
  ): void {
    if (Math.abs(angleRad) < 1e-8) return;
    const { componentIds, jointIds } = this.getDownstreamSubgraph(startPortId, blockedComponentId);
    const normAxis = axis.clone().normalize();
    const rotQuat = new THREE.Quaternion().setFromAxisAngle(normAxis, angleRad);

    const rotatePoint = (pt: THREE.Vector3) => {
      pt.sub(pivot).applyAxisAngle(normAxis, angleRad).add(pivot);
    };
    for (const s of this.supportsOnComponents(componentIds)) rotatePoint(s.position);

    for (const compId of componentIds) {
      const comp = this.components.get(compId);
      if (!comp) continue;
      for (const p of comp.ports) {
        rotatePoint(p.position);
        p.direction.applyAxisAngle(normAxis, angleRad).normalize();
      }
      for (const pt of comp.centerline) {
        rotatePoint(pt);
      }
      if (comp.parameters.matrixElements && comp.parameters.matrixElements.length === 16) {
        const mat = new THREE.Matrix4().fromArray(comp.parameters.matrixElements);
        const pos = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        const scl = new THREE.Vector3();
        mat.decompose(pos, quat, scl);
        rotatePoint(pos);
        quat.premultiply(rotQuat);
        mat.compose(pos, quat, scl);
        comp.parameters.matrixElements = Array.from(mat.elements);
      }
    }

    for (const jId of jointIds) {
      const joint = this.joints.get(jId);
      if (joint) {
        rotatePoint(joint.position);
      }
    }
  }

  /**
   * Rota el ramal de una Te (TEE) o la salida de un Codo (ELBOW) alrededor de su eje de entrada,
   * arrastrando automáticamente toda la línea o derivación conectada aguas abajo.
   */
  public rotateComponentAroundRun(componentId: string, angleDeg: number = 90): Component | null {
    const comp = this.components.get(componentId);
    if (!comp) return null;

    const rad = THREE.MathUtils.degToRad(angleDeg);

    if (comp.type === 'TEE' && comp.ports.length >= 3 && comp.centerline.length >= 4) {
      const portBranch = comp.ports[2];
      const uRun = comp.ports[1].direction.clone().normalize();
      const vertex = comp.centerline[1].clone();
      const M = comp.parameters.branchTakeOff || vertex.distanceTo(portBranch.position) || 63.5;

      // Si el ramal tiene piezas conectadas, rotar todo el subgrafo del ramal alrededor de (vertex, uRun)
      if (portBranch.connectedJointId) {
        this.rotateDownstream(portBranch.id, comp.id, vertex, uRun, rad);
      }

      const newBranchDir = portBranch.direction.clone().applyAxisAngle(uRun, rad).normalize();
      const newP3 = vertex.clone().add(newBranchDir.clone().multiplyScalar(M));

      portBranch.direction.copy(newBranchDir);
      portBranch.position.copy(newP3);
      comp.centerline[3].copy(newP3);
      return comp;
    }

    if (comp.type === 'VALVE') {
      // El volante o la palanca giran alrededor del caño; las bocas no se mueven
      const next = (((comp.parameters.stemAngle ?? 0) + angleDeg) % 360 + 360) % 360;
      comp.parameters.stemAngle = next < 0.01 ? undefined : next;
      return comp;
    }

    if (comp.type === 'ELBOW' && comp.ports.length >= 2) {
      const portOut = comp.ports[1];
      const p1 = comp.ports[0].position.clone();
      const uIn = comp.ports[0].direction.clone().negate().normalize();
      const takeOff = comp.parameters.takeOff || comp.parameters.radius || 76.2;
      const vertex = p1.clone().add(uIn.clone().multiplyScalar(takeOff));

      if (portOut.connectedJointId) {
        this.rotateDownstream(portOut.id, comp.id, vertex, uIn, rad);
      }

      const newUOut = portOut.direction.clone().applyAxisAngle(uIn, rad).normalize();
      const pStart = p1.clone().sub(uIn.clone().multiplyScalar(takeOff));
      const pNext = vertex.clone().add(newUOut.clone().multiplyScalar(takeOff * 2));

      const placement = calculateElbowPlacement(pStart, vertex, pNext, takeOff, comp.parameters.radius);
      portOut.position.copy(placement.cutPoint2);
      portOut.direction.copy(newUOut);
      comp.centerline = placement.centerline.map((pt) => pt.clone());
      comp.parameters.matrixElements = Array.from(placement.matrix.elements);
      return comp;
    }

    return null;
  }

  /**
   * Modifica la longitud de un tramo de caño existente (PIPE) y propaga el desplazamiento
   * a todos los accesorios y cañerías conectados aguas abajo (como AutoCAD Plant 3D).
   */
  public updatePipeLength(componentId: string, newLengthMm: number, anchor: 'start' | 'end' = 'start'): Component | null {
    const comp = this.components.get(componentId);
    if (!comp || comp.type !== 'PIPE' || newLengthMm <= 10 || comp.ports.length < 2) return null;

    // El extremo de anclaje queda quieto; el otro se mueve y arrastra lo que tenga conectado
    const fixed = anchor === 'start' ? comp.ports[0] : comp.ports[1];
    const moving = anchor === 'start' ? comp.ports[1] : comp.ports[0];

    const dir = moving.direction.clone().normalize();
    const oldEnd = moving.position.clone();
    const newEnd = fixed.position.clone().add(dir.multiplyScalar(newLengthMm));
    const delta = new THREE.Vector3().subVectors(newEnd, oldEnd);

    if (moving.connectedJointId) {
      this.translateDownstream(moving.id, comp.id, delta);
    }

    moving.position.copy(newEnd);
    comp.centerline[anchor === 'start' ? 1 : 0].copy(newEnd);
    comp.parameters.cutLength = newLengthMm;
    comp.parameters.grossLength = newLengthMm;
    return comp;
  }

  /**
   * ¿Mover lo conectado a `movingPort` arrastraría también lo que está del otro lado de la pieza?
   * Pasa cuando la línea cierra un circuito: ahí no se puede estirar ni cambiar una pieza sin romperlo.
   */
  public closesLoopThrough(componentId: string, movingPortId: string): boolean {
    const comp = this.components.get(componentId);
    if (!comp) return false;
    const { componentIds } = this.getDownstreamSubgraph(movingPortId, componentId);
    for (const port of comp.ports) {
      if (port.id === movingPortId || !port.connectedJointId) continue;
      const joint = this.joints.get(port.connectedJointId);
      const otherId = joint ? (joint.portAId === port.id ? joint.portBId : joint.portAId) : null;
      const other = otherId ? this.ports.get(otherId) : null;
      if (other && componentIds.has(other.componentId)) return true;
    }
    return false;
  }

  /**
   * Sustituye un codo en su lugar por otro de la spec (otro ángulo u otra familia). La entrada
   * (puerto 1) queda fija; lo conectado a la salida gira y se corre para seguir unido.
   */
  public swapElbow(componentId: string, elbowSpec: SpecFitting, angleDeg: number): Component | null {
    const comp = this.components.get(componentId);
    if (!comp || comp.type !== 'ELBOW' || comp.ports.length < 2) return null;
    const [portIn, portOut] = comp.ports;
    const uIn = portIn.direction.clone().negate().normalize();
    const uOutOld = portOut.direction.clone().normalize();
    const k = uIn.dot(uOutOld);
    const axis = new THREE.Vector3().crossVectors(uIn, uOutOld);
    if (axis.lengthSq() < 1e-8 || 1 - k * k < 1e-8) return null;
    axis.normalize();

    // Vértice actual: donde se cruzan los ejes de entrada y de salida
    const chord = portOut.position.clone().sub(portIn.position);
    const s0 = (chord.dot(uIn) - k * chord.dot(uOutOld)) / (1 - k * k);
    const u0 = (chord.dot(uOutOld) - k * chord.dot(uIn)) / (1 - k * k);
    const oldVertex = portIn.position.clone().addScaledVector(uIn, s0);

    const newRad = THREE.MathUtils.degToRad(angleDeg);
    const takeOff = elbowSpec.takeOff || (elbowSpec.radius ? elbowSpec.radius * Math.tan(newRad / 2) : 0);
    if (!takeOff) return null;
    const deltaRad = newRad - Math.acos(THREE.MathUtils.clamp(k, -1, 1));
    const uOutNew = uOutOld.clone().applyAxisAngle(axis, deltaRad).normalize();
    const newVertex = portIn.position.clone().addScaledVector(uIn, takeOff);
    const newOut = newVertex.clone().addScaledVector(uOutNew, elbowSpec.takeOff2 || takeOff);

    if (portOut.connectedJointId) {
      this.rotateDownstream(portOut.id, comp.id, oldVertex, axis, deltaRad);
      this.translateDownstream(portOut.id, comp.id, newOut.clone().sub(oldVertex.clone().addScaledVector(uOutNew, u0)));
    }

    const placement = calculateElbowPlacement(
      portIn.position.clone().addScaledVector(uIn, -100),
      newVertex,
      newVertex.clone().addScaledVector(uOutNew, takeOff + 100),
      takeOff,
      elbowSpec.radius
    );
    const refresh = (port: Port, position: THREE.Vector3, direction: THREE.Vector3, specIndex: number) =>
      Object.assign(port, this.portFromSpec(comp.id, port.index, position, direction, elbowSpec, specIndex), {
        id: port.id,
        connectedJointId: port.connectedJointId
      });
    refresh(portIn, portIn.position, portIn.direction, 0);
    refresh(portOut, newOut, uOutNew, 1);

    comp.specCode = elbowSpec.specCode;
    comp.catalogId = String(elbowSpec.pnpid);
    comp.centerline = placement.centerline.map((pt) => pt.clone());
    Object.assign(comp.parameters, {
      nominalDiameter: elbowSpec.nominalDiameter,
      outerDiameter: elbowSpec.outerDiameter,
      wallThickness: elbowSpec.wallThickness,
      schedule: elbowSpec.schedule,
      angle: placement.bendAngleDeg,
      radius: elbowSpec.radius || elbowSpec.takeOff,
      takeOff: elbowSpec.takeOff,
      description: elbowSpec.shortDescription,
      matrixElements: Array.from(placement.matrix.elements),
      ...this.specParameters(elbowSpec)
    });
    // El bloque del PCF de origen describía la pieza anterior
    delete comp.parameters.pcf;
    return comp;
  }

  /**
   * Sustituye una válvula en su lugar por otra de la spec con los mismos extremos. La entrada queda
   * fija; si cambia el largo entre caras, lo conectado a la salida se corre.
   */
  public swapValve(componentId: string, valveSpec: SpecFitting): Component | null {
    const comp = this.components.get(componentId);
    if (!comp || comp.type !== 'VALVE' || comp.ports.length < 2) return null;
    const [portIn, portOut] = comp.ports;
    const dir = portOut.direction.clone().normalize();
    const span = valveSpec.faceToFace || comp.parameters.faceToFace || portIn.position.distanceTo(portOut.position);
    const newOut = portIn.position.clone().addScaledVector(dir, span);
    if (portOut.connectedJointId) this.translateDownstream(portOut.id, comp.id, newOut.clone().sub(portOut.position));
    portOut.position.copy(newOut);
    comp.centerline = [portIn.position.clone(), newOut.clone()];
    comp.specCode = valveSpec.specCode;
    comp.catalogId = String(valveSpec.pnpid);
    Object.assign(comp.parameters, {
      faceToFace: span,
      boltCircle: valveSpec.boltCircle || comp.parameters.boltCircle,
      description: valveSpec.shortDescription,
      ...this.specParameters(valveSpec)
    });
    delete comp.parameters.pcf;
    return comp;
  }

  /** Boca del otro lado de la unión, si la boca está unida */
  public matedPort(port: Port): Port | null {
    const joint = port.connectedJointId ? this.joints.get(port.connectedJointId) : null;
    if (!joint) return null;
    return this.ports.get(joint.portAId === port.id ? joint.portBId : joint.portAId) ?? null;
  }

  /** Vuelve a resolver la unión de una boca después de cambiarle el extremo o moverla */
  public refreshJoint(port: Port): string[] {
    const joint = port.connectedJointId ? this.joints.get(port.connectedJointId) : null;
    const other = this.matedPort(port);
    if (!joint || !other) return [];
    const resolved = this.resolveJoint(port, other);
    joint.type = resolved.jointType;
    joint.plantJoint = resolved.plantJoint;
    joint.position = port.position.clone().lerp(other.position, 0.5);
    return resolved.problems;
  }

  /**
   * Qué hace "dar vuelta" con una pieza: una brida cambia la cara de lado, una válvula cambia
   * el sentido de flujo y una reducción excéntrica pasa de plano abajo a plano arriba.
   */
  public flipKind(componentId: string): 'flange' | 'valve' | 'reducer' | null {
    const comp = this.components.get(componentId);
    if (!comp || comp.ports.length !== 2) return null;
    if (comp.type === 'FLANGE') return isFaceEnd(comp.ports[0]) !== isFaceEnd(comp.ports[1]) ? 'flange' : null;
    if (comp.type === 'VALVE') return 'valve';
    if (comp.type === 'REDUCER') return this.reducerLateral(comp).length() > 0.05 ? 'reducer' : null;
    return null;
  }

  /** Corrimiento lateral de la salida de una reducción respecto del eje de entrada */
  private reducerLateral(comp: Component): THREE.Vector3 {
    const [a, b] = comp.ports;
    const axis = b.direction.clone().normalize();
    const span = b.position.clone().sub(a.position);
    return span.addScaledVector(axis, -span.dot(axis));
  }

  /** ¿Hacia dónde queda la generatriz recta de una excéntrica? null si es concéntrica o está de costado */
  public reducerFlatSide(componentId: string): 'abajo' | 'arriba' | null {
    const comp = this.components.get(componentId);
    if (!comp || comp.type !== 'REDUCER' || comp.ports.length !== 2) return null;
    const lateral = this.reducerLateral(comp);
    if (lateral.length() < 0.05) return null;
    // El eje del extremo chico se corre hacia el lado del plano
    const [a, b] = comp.ports;
    const towardSmall = a.nominalDiameter > b.nominalDiameter ? lateral : lateral.clone().negate();
    const axis = b.direction.clone().normalize();
    const down = Math.abs(axis.z) > 0.9 ? new THREE.Vector3(-1, 0, 0) : new THREE.Vector3(0, 0, -1);
    const d = towardSmall.normalize().dot(down);
    return d > 0.5 ? 'abajo' : d < -0.5 ? 'arriba' : null;
  }

  /**
   * Da vuelta una pieza en su lugar (ver `flipKind`). En la excéntrica la salida se corre al otro
   * lado y arrastra lo que tenga conectado. Devuelve los avisos de las uniones que quedaron mal.
   */
  public flipComponent(componentId: string): { kind: 'flange' | 'valve' | 'reducer'; problems: string[] } | null {
    const comp = this.components.get(componentId);
    const kind = this.flipKind(componentId);
    if (!comp || !kind) return null;
    const [a, b] = comp.ports;
    if (kind === 'flange') {
      // La cara pasa al otro extremo: las bocas intercambian diámetro, extremo y clase
      const keys = ['nominalDiameter', 'outerDiameter', 'wallThickness', 'schedule', 'endType', 'plantEndType', 'pressureClass'] as const;
      const record = (p: Port) => p as unknown as Record<string, unknown>;
      for (const k of keys) {
        const tmp = record(a)[k];
        record(a)[k] = record(b)[k];
        record(b)[k] = tmp;
      }
    } else if (kind === 'valve') {
      // Sentido de flujo: la entrada pasa a ser la salida
      comp.ports.reverse();
      comp.ports.forEach((p, i) => (p.index = i + 1));
      comp.centerline.reverse();
    } else {
      const delta = this.reducerLateral(comp).multiplyScalar(-2);
      if (b.connectedJointId) this.translateDownstream(b.id, comp.id, delta);
      b.position.add(delta);
      comp.centerline[comp.centerline.length - 1].copy(b.position);
    }
    delete comp.parameters.pcf;
    const problems = [...this.refreshJoint(a), ...this.refreshJoint(b)];
    return { kind, problems };
  }

  /** Todas las piezas unidas, directa o indirectamente, a una pieza (la línea entera) */
  public connectedRun(componentId: string): string[] {
    const seen = new Set<string>([componentId]);
    const queue = [componentId];
    while (queue.length) {
      const comp = this.components.get(queue.shift()!);
      for (const port of comp?.ports ?? []) {
        const joint = port.connectedJointId ? this.joints.get(port.connectedJointId) : null;
        if (!joint) continue;
        const other = this.ports.get(joint.portAId === port.id ? joint.portBId : joint.portAId);
        if (other && !seen.has(other.componentId)) {
          seen.add(other.componentId);
          queue.push(other.componentId);
        }
      }
      // Olets e injertos: unen el ramal con el caño donde apoyan
      const linked = !comp ? [] : comp.type === 'OLET' ? [this.oletHost(comp)] : this.oletsOn(comp);
      for (const other of linked) {
        if (other && !seen.has(other.id)) {
          seen.add(other.id);
          queue.push(other.id);
        }
      }
    }
    return [...seen];
  }

  /** Distancia de un punto al eje de un caño (segmento entre sus dos bocas) */
  private distanceToPipeAxis(point: THREE.Vector3, pipe: Component): number {
    const a = pipe.ports[0].position;
    const ab = pipe.ports[1].position.clone().sub(a);
    const len2 = ab.lengthSq();
    const t = len2 < 1e-9 ? 0 : THREE.MathUtils.clamp(point.clone().sub(a).dot(ab) / len2, 0, 1);
    return a.clone().addScaledVector(ab, t).distanceTo(point);
  }

  private isOnPipe(point: THREE.Vector3, pipe: Component): boolean {
    if (pipe.type !== 'PIPE' || pipe.ports.length < 2) return false;
    return this.distanceToPipeAxis(point, pipe) <= pipe.parameters.outerDiameter / 2 + 2;
  }

  /** Olets e injertos apoyados sobre un caño */
  public oletsOn(pipe: Component): Component[] {
    if (pipe.type !== 'PIPE' || pipe.ports.length < 2) return [];
    const out: Component[] = [];
    for (const c of this.components.values()) {
      if (c.type === 'OLET' && c.centerline[0] && this.isOnPipe(c.centerline[0], pipe)) out.push(c);
    }
    return out;
  }

  /** Caño sobre el que apoya un olet o injerto */
  public oletHost(olet: Component): Component | null {
    const c = olet.centerline[0];
    if (!c) return null;
    for (const comp of this.components.values()) if (this.isOnPipe(c, comp)) return comp;
    return null;
  }

  /**
   * Derivación sobre un caño sin cortarlo: olet de la spec o, si no se pasa pieza, injerto directo
   * (stub-in). `branch` describe el caño del ramal. Devuelve la pieza con su boca libre.
   */
  public addBranchOnPipe(
    pipeId: string,
    offsetMm: number,
    branchDir: THREE.Vector3,
    branch: SpecFitting,
    oletSpec?: SpecFitting | null
  ): Component {
    const pipe = this.components.get(pipeId);
    if (!pipe || pipe.type !== 'PIPE' || pipe.ports.length < 2) throw new Error('La derivación se hace sobre un caño.');
    const a = pipe.ports[0].position;
    const axis = pipe.ports[1].position.clone().sub(a);
    const length = axis.length();
    axis.normalize();
    const dir = branchDir.clone().addScaledVector(axis, -branchDir.dot(axis));
    if (dir.lengthSq() < 1e-6) throw new Error('El ramal tiene que salir hacia un costado del caño, no a lo largo.');
    dir.normalize();
    const headerOd = pipe.parameters.outerDiameter;
    if (branch.outerDiameter > headerOd + 0.1) throw new Error('El ramal no puede ser más grande que el caño donde apoya.');
    const margin = branch.outerDiameter / 2 + 10;
    if (length < 2 * margin) throw new Error('El caño es demasiado corto para esa derivación.');
    const centre = a.clone().addScaledVector(axis, THREE.MathUtils.clamp(offsetMm, margin, length - margin));

    const compId = this.generateId('olet');
    // Olet: sobresale del lomo del caño; injerto: el ramal nace en el lomo
    const height = oletSpec ? oletSpec.faceToFace || Math.max(25, branch.outerDiameter * 0.75) : 0;
    const takeOff = headerOd / 2 + height;
    const portPos = centre.clone().addScaledVector(dir, takeOff);
    const port: Port = oletSpec
      ? this.portFromSpec(compId, 1, portPos, dir, oletSpec, 1)
      : { ...this.portFromSpec(compId, 1, portPos, dir, branch, 0), endType: 'BW', plantEndType: 'BV' };
    port.nominalDiameter = branch.nominalDiameter;
    port.outerDiameter = branch.outerDiameter;

    const component: Component = {
      id: compId,
      type: 'OLET',
      specCode: (oletSpec ?? branch).specCode,
      catalogId: oletSpec ? String(oletSpec.pnpid) : 'STUB-IN',
      ports: [port],
      centerline: [centre.clone(), portPos.clone()],
      parameters: {
        nominalDiameter: pipe.parameters.nominalDiameter,
        outerDiameter: headerOd,
        wallThickness: branch.wallThickness,
        schedule: branch.schedule,
        reducedNominalDiameter: branch.nominalDiameter,
        reducedOuterDiameter: branch.outerDiameter,
        takeOff,
        ...(oletSpec ? this.specParameters(oletSpec) : {}),
        description: oletSpec
          ? oletSpec.shortDescription
          : `INJERTO (STUB-IN) ${pipe.parameters.nominalDiameter}" x ${branch.nominalDiameter}"`,
        stubIn: oletSpec ? undefined : true,
        lineNumber: pipe.parameters.lineNumber
      }
    };
    this.addComponent(component);
    return component;
  }

  /** Marca un soporte sobre un caño, a `offsetMm` de su inicio */
  public addSupport(pipeId: string, offsetMm: number, kind: SupportKind): SupportMark {
    const pipe = this.components.get(pipeId);
    if (!pipe || pipe.type !== 'PIPE' || pipe.ports.length < 2) throw new Error('El soporte se marca sobre un caño.');
    const a = pipe.ports[0].position;
    const axis = pipe.ports[1].position.clone().sub(a);
    const length = axis.length();
    const position = a.clone().addScaledVector(axis.normalize(), THREE.MathUtils.clamp(offsetMm, 0, length));
    const mark: SupportMark = { id: this.generateId('sup'), kind, position, nominalDiameter: pipe.parameters.nominalDiameter };
    this.supports.set(mark.id, mark);
    return mark;
  }

  public removeSupport(id: string): boolean {
    return this.supports.delete(id);
  }

  /** Cambia los datos de un soporte: clase, tipo y tag de Plant, altura y giro */
  public updateSupport(
    id: string,
    patch: Partial<Pick<SupportMark, 'kind' | 'tag' | 'plantType' | 'heightMm' | 'rotationDeg'>>
  ): SupportMark {
    const mark = this.supports.get(id);
    if (!mark) throw new Error('Ese soporte ya no está en el modelo.');
    if (patch.kind !== undefined) mark.kind = patch.kind;
    if (patch.tag !== undefined) mark.tag = patch.tag.trim() || undefined;
    if (patch.plantType !== undefined) mark.plantType = patch.plantType.trim() || undefined;
    if (patch.heightMm !== undefined) mark.heightMm = Number.isFinite(patch.heightMm) && patch.heightMm > 0 ? Math.round(patch.heightMm) : undefined;
    if (patch.rotationDeg !== undefined) {
      const r = ((Math.round(patch.rotationDeg) % 360) + 360) % 360;
      mark.rotationDeg = r || undefined;
    }
    return mark;
  }

  /** Caño que sostiene un soporte (por posición) */
  public supportHost(mark: SupportMark): Component | null {
    for (const comp of this.components.values()) if (this.isOnPipe(mark.position, comp)) return comp;
    return null;
  }

  /** Soportes que siguen apoyados en un caño; los que quedaron en el aire se descartan */
  public liveSupports(): SupportMark[] {
    for (const [id, mark] of this.supports) if (!this.supportHost(mark)) this.supports.delete(id);
    return [...this.supports.values()];
  }

  /** Soporte más cercano a un punto de un caño, dentro de `maxMm` */
  public supportNear(pipeId: string, point: THREE.Vector3, maxMm = 150): SupportMark | null {
    const pipe = this.components.get(pipeId);
    if (!pipe) return null;
    let best: SupportMark | null = null;
    for (const mark of this.supports.values()) {
      if (!this.isOnPipe(mark.position, pipe)) continue;
      const d = mark.position.distanceTo(point);
      if (d <= maxMm && (!best || d < best.position.distanceTo(point))) best = mark;
    }
    return best;
  }

  private supportsOnComponents(ids: Iterable<string>): SupportMark[] {
    const pipes = [...ids].map((id) => this.components.get(id)).filter((c): c is Component => !!c && c.type === 'PIPE');
    if (!pipes.length || !this.supports.size) return [];
    return [...this.supports.values()].filter((s) => pipes.some((p) => this.isOnPipe(s.position, p)));
  }

  private shiftComponent(comp: Component, delta: THREE.Vector3): void {
    for (const port of comp.ports) port.position.add(delta);
    for (const pt of comp.centerline) pt.add(delta);
    const m = comp.parameters.matrixElements;
    if (m && m.length === 16) {
      const next = [...m];
      next[12] += delta.x;
      next[13] += delta.y;
      next[14] += delta.z;
      comp.parameters.matrixElements = next;
    }
  }

  /**
   * Mueve un grupo de piezas. Las uniones entre ellas se conservan; las que las ataban al resto
   * del modelo se sueltan (quedan bocas libres), como al mover piezas en Plant 3D.
   * Devuelve cuántas uniones se soltaron.
   */
  public translateComponents(componentIds: string[], delta: THREE.Vector3): number {
    const ids = new Set(componentIds);
    let detached = 0;
    const moved = new Set<string>();
    for (const s of this.supportsOnComponents(ids)) s.position.add(delta);
    for (const id of ids) {
      const comp = this.components.get(id);
      if (!comp) continue;
      for (const port of comp.ports) {
        const joint = port.connectedJointId ? this.joints.get(port.connectedJointId) : null;
        if (!joint) continue;
        const other = this.ports.get(joint.portAId === port.id ? joint.portBId : joint.portAId);
        if (other && ids.has(other.componentId)) {
          if (!moved.has(joint.id)) {
            joint.position.add(delta);
            moved.add(joint.id);
          }
        } else {
          this.removeJoint(joint.id);
          detached++;
        }
      }
      this.shiftComponent(comp, delta);
    }
    return detached;
  }

  /** Copia un grupo de piezas corrido en `delta`, con las uniones que tenían entre ellas */
  public duplicateComponents(componentIds: string[], delta: THREE.Vector3): string[] {
    const ids = new Set(componentIds);
    const portMap = new Map<string, string>();
    const created: string[] = [];
    for (const id of ids) {
      const src = this.components.get(id);
      if (!src) continue;
      const compId = this.generateId(src.type.toLowerCase());
      const copy: Component = {
        ...src,
        id: compId,
        ports: src.ports.map((port) => {
          const portId = this.generateId('prt');
          portMap.set(port.id, portId);
          return {
            ...port,
            id: portId,
            componentId: compId,
            position: port.position.clone(),
            direction: port.direction.clone(),
            connectedJointId: undefined
          };
        }),
        centerline: src.centerline.map((pt) => pt.clone()),
        // La copia es una pieza nueva: no hereda el tag ni el bloque PCF de la original
        parameters: { ...src.parameters, nippleTag: undefined, pcf: undefined }
      };
      this.shiftComponent(copy, delta);
      this.addComponent(copy);
      created.push(compId);
    }
    for (const joint of [...this.joints.values()]) {
      const a = portMap.get(joint.portAId);
      const b = portMap.get(joint.portBId);
      if (!a || !b) continue;
      const jointId = this.generateId('jnt');
      this.joints.set(jointId, { ...joint, id: jointId, portAId: a, portBId: b, position: joint.position.clone().add(delta) });
      this.ports.get(a)!.connectedJointId = jointId;
      this.ports.get(b)!.connectedJointId = jointId;
    }
    return created;
  }

  /**
   * Actualiza los tipos de preparación de extremos (Plano, Bisel, Roscado) de un niple
   */
  public updatePipeEndFinishes(
    componentId: string,
    endFinish1: NippleEndFinish,
    endFinish2: NippleEndFinish
  ): Component | null {
    const comp = this.components.get(componentId);
    if (!comp || comp.type !== 'PIPE') return null;
    comp.parameters.endFinish1 = endFinish1;
    comp.parameters.endFinish2 = endFinish2;
    return comp;
  }

  /**
   * Actualiza metadatos de identificación de un componente (nippleTag, lineNumber, description)
   */
  public updateComponentMetadata(
    componentId: string,
    metadata: { nippleTag?: string; lineNumber?: string; description?: string }
  ): Component | null {
    const comp = this.components.get(componentId);
    if (!comp) return null;
    if (metadata.nippleTag !== undefined) {
      comp.parameters.nippleTag = metadata.nippleTag.trim() || undefined;
    }
    if (metadata.lineNumber !== undefined) {
      comp.parameters.lineNumber = metadata.lineNumber.trim() || undefined;
    }
    if (metadata.description !== undefined) {
      comp.parameters.description = metadata.description;
    }
    return comp;
  }

  /**
   * Parte un caño existente en dos niples e inserta un accesorio en línea, descontando los
   * largos reales y reconectando las uniones (como AutoCAD Plant 3D):
   * - TEE: una tee de la spec;
   * - VALVE: la válvula; si es bridada y el caño no, entran las dos bridas con sus juntas (AutoFlange);
   * - FLANGE: una unión bridada (par de bridas con junta).
   */
  public splitPipeWithFitting(
    pipeId: string,
    fittingSpec: SpecFitting,
    pipeSpec: SpecFitting,
    options?: {
      offsetMm?: number;
      branchDir?: THREE.Vector3;
      gasketSpec?: SpecFitting | null;
      boltSetSpec?: SpecFitting | null;
      /** Brida a usar cuando hay que bridar una válvula o armar una unión bridada */
      flangeSpec?: SpecFitting | null;
    }
  ): { pipe1: Component; fitting: Component; pipe2: Component; extra: Component[] } | null {
    const origPipe = this.components.get(pipeId);
    if (!origPipe || origPipe.type !== 'PIPE' || origPipe.ports.length < 2) return null;

    const pStart = origPipe.ports[0].position.clone();
    const pEnd = origPipe.ports[1].position.clone();
    const totalLen = pStart.distanceTo(pEnd);
    const uRun = new THREE.Vector3().subVectors(pEnd, pStart).normalize();

    const gap = options?.gasketSpec?.gasketThicknessMm ?? 0;
    const flangeSpan = options?.flangeSpec?.faceToFace ?? 0;
    const valveIsFlanged =
      fittingSpec.partType === 'VALVE' &&
      (fittingSpec.plantEndTypes ? isFaceEnd({ plantEndType: fittingSpec.plantEndTypes[0], endType: fittingSpec.endType }) : false);
    const needsFlanges = (valveIsFlanged || fittingSpec.partType === 'FLANGE') && !!options?.flangeSpec;

    let span = 0;
    if (fittingSpec.partType === 'TEE') span = 2 * (fittingSpec.runTakeOff || 63.5);
    else if (fittingSpec.partType === 'FLANGE') span = needsFlanges ? 2 * flangeSpan + gap : fittingSpec.faceToFace || 100;
    else span = (fittingSpec.faceToFace || 100) + (needsFlanges ? 2 * flangeSpan + 2 * gap : 0);

    const minNipple = 50;
    if (totalLen < span + minNipple * 2) {
      throw new Error(
        `El caño (${Math.round(totalLen)} mm) es demasiado corto para insertar ${fittingSpec.partType} (${Math.round(span)} mm) y dejar dos niples mínimos de ${minNipple} mm.`
      );
    }

    const defaultCenter = totalLen / 2;
    const centerDist = THREE.MathUtils.clamp(
      options?.offsetMm !== undefined ? options.offsetMm : defaultCenter,
      span / 2 + minNipple,
      totalLen - span / 2 - minNipple
    );
    const cut1 = pStart.clone().add(uRun.clone().multiplyScalar(centerDist - span / 2));

    // Recordar conexiones previas en los extremos del caño original
    const otherEnd = (portIdx: number): { id: string; type: JointType } | null => {
      const jid = origPipe.ports[portIdx].connectedJointId;
      const j = jid ? this.joints.get(jid) : undefined;
      if (!j) return null;
      return { id: j.portAId === origPipe.ports[portIdx].id ? j.portBId : j.portAId, type: j.type };
    };
    const upstream = otherEnd(0);
    const downstream = otherEnd(1);

    this.removeComponent(origPipe.id);

    const pipe1 = this.addPipe(pStart, cut1, pipeSpec, pStart.distanceTo(cut1));
    this.inheritPipeIdentity(origPipe, pipe1);
    if (upstream) this.connectPorts(upstream.id, pipe1.ports[0].id, upstream.type);

    const extra: Component[] = [];
    let fitting: Component;
    let outPort: Port;
    if (fittingSpec.partType === 'TEE') {
      const bDir =
        options?.branchDir ||
        (Math.abs(uRun.z) < 0.8 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0));
      fitting = this.addTee(pipe1.ports[1], bDir, fittingSpec);
      outPort = fitting.ports[1];
    } else if (fittingSpec.partType === 'VALVE') {
      const assembly = this.addValveAssembly(pipe1.ports[1], fittingSpec, {
        flangeSpec: needsFlanges ? options!.flangeSpec : null,
        gasketSpec: options?.gasketSpec,
        boltSetSpec: options?.boltSetSpec
      });
      fitting = assembly.valve;
      extra.push(...assembly.flanges);
      outPort = assembly.outPort;
    } else {
      fitting = this.addFlange(pipe1.ports[1], needsFlanges ? options!.flangeSpec! : fittingSpec, options?.gasketSpec, options?.boltSetSpec);
      outPort = fitting.ports[1];
      if (needsFlanges) {
        const fB = this.addFlange(outPort, options!.flangeSpec!, options?.gasketSpec, options?.boltSetSpec);
        extra.push(fB);
        outPort = fB.ports[1];
      }
    }

    const pipe2Start = outPort.position.clone();
    const pipe2 = this.addPipe(pipe2Start, pEnd, pipeSpec, pipe2Start.distanceTo(pEnd));
    this.inheritPipeIdentity(origPipe, pipe2);
    this.connectPorts(outPort.id, pipe2.ports[0].id);
    if (downstream) this.connectPorts(pipe2.ports[1].id, downstream.id, downstream.type);

    return { pipe1, fitting, pipe2, extra };
  }

  /**
   * Inserta una reducción en un puerto abierto. El extremo chico toma diámetro y OD del
   * puerto S2 de la spec; las excéntricas corren el eje chico (por defecto, plano abajo).
   */
  public addReducer(port: Port, reducerSpec: SpecFitting, reversed = false, flatUp = false): Component {
    const compId = this.generateId('red');
    const L = reducerSpec?.faceToFace || 88.9;
    const dir = port.direction.clone().normalize();

    const nd1 = reducerSpec?.nominalDiameter || port.nominalDiameter;
    const od1 = reducerSpec?.outerDiameter || port.outerDiameter;
    const targetND = reducerSpec?.reducedNominalDiameter || (nd1 > 1 ? nd1 - 1 : 2);
    const targetOD = reducerSpec?.reducedOuterDiameter || targetND * 25.4;

    const p1 = port.position.clone();
    const p2 = p1.clone().addScaledVector(dir, L);
    const offset = reducerSpec?.lateralOffset ?? 0;
    if (offset > 0) {
      // Plano abajo: el eje chico baja (dirección -Z); en tramos verticales se usa -X
      const down = Math.abs(dir.z) > 0.9 ? new THREE.Vector3(-1, 0, 0) : new THREE.Vector3(0, 0, -1);
      down.addScaledVector(dir, -down.dot(dir)).normalize();
      // Plano arriba: se alinean las generatrices de arriba y el eje chico sube
      p2.addScaledVector(down, (reversed ? -offset : offset) * (flatUp ? -1 : 1));
    }

    // `reversed`: ampliación, se entra por el extremo chico y se sale por el grande
    const port1 = this.portFromSpec(compId, 1, p1, dir.clone().negate(), reducerSpec, reversed ? 1 : 0);
    const port2 = this.portFromSpec(compId, 2, p2, dir, reducerSpec, reversed ? 0 : 1);
    const small = reversed ? port1 : port2;
    small.nominalDiameter = targetND;
    small.outerDiameter = targetOD;
    const big = reversed ? port2 : port1;
    big.nominalDiameter = nd1;
    big.outerDiameter = od1;

    const component: Component = {
      id: compId,
      type: 'REDUCER',
      specCode: reducerSpec?.specCode || this.activeSpec,
      catalogId: String(reducerSpec?.pnpid || 'RED'),
      ports: [port1, port2],
      centerline: [p1.clone(), p2.clone()],
      parameters: {
        nominalDiameter: nd1,
        outerDiameter: od1,
        reducedNominalDiameter: targetND,
        reducedOuterDiameter: targetOD,
        wallThickness: reducerSpec.wallThickness || port.wallThickness,
        schedule: reducerSpec.schedule || port.schedule,
        faceToFace: L,
        lateralOffset: offset > 0 ? offset : undefined,
        description: reducerSpec?.shortDescription || `Reducción ${nd1}"x${targetND}"`,
        ...this.specParameters(reducerSpec)
      }
    };

    this.addComponent(component);
    this.connectPorts(port.id, port1.id);
    return component;
  }

  /**
   * Brida ciega: cierra la línea contra una cara de brida, con junta y bulones. Si la boca es un
   * extremo de caño entra primero la brida de la spec.
   */
  public addBlindFlange(
    port: Port,
    blindSpec: SpecFitting,
    options: { flangeSpec?: SpecFitting | null; gasketSpec?: SpecFitting | null; boltSetSpec?: SpecFitting | null } = {}
  ): { blind: Component; flange: Component | null } {
    const { flangeSpec, gasketSpec, boltSetSpec } = options;
    let flange: Component | null = null;
    let face = port;
    if (!isFaceEnd(port)) {
      if (!flangeSpec) throw new Error('La brida ciega va contra una cara de brida y la spec no tiene brida para esta boca.');
      flange = this.addFlange(port, flangeSpec, gasketSpec, boltSetSpec);
      face = flange.ports[1];
    }
    const compId = this.generateId('flg');
    const thickness = blindSpec.faceToFace || blindSpec.visual?.flangeThickness || 20;
    const gap = gasketSpec?.gasketThicknessMm ?? 0;
    const dir = face.direction.clone().normalize();
    const p1 = face.position.clone().addScaledVector(dir, gap);
    const p2 = p1.clone().addScaledVector(dir, thickness);
    const port1 = this.portFromSpec(compId, 1, p1, dir.clone().negate(), blindSpec, 0);
    if (!blindSpec.plantEndTypes) port1.endType = 'FLANG';
    port1.nominalDiameter = face.nominalDiameter;
    port1.outerDiameter = face.outerDiameter;

    const nd = face.nominalDiameter;
    const boltCount = boltSetSpec?.boltCount || blindSpec.boltHoles || (nd >= 4 ? 8 : 4);
    const blind: Component = {
      id: compId,
      type: 'FLANGE',
      specCode: blindSpec.specCode,
      catalogId: String(blindSpec.pnpid),
      ports: [port1],
      centerline: [p1.clone(), p2.clone()],
      parameters: {
        nominalDiameter: nd,
        outerDiameter: face.outerDiameter,
        wallThickness: blindSpec.wallThickness,
        schedule: blindSpec.schedule,
        faceToFace: thickness,
        boltCircle: blindSpec.boltCircle || face.outerDiameter * 1.3,
        boltHoles: boltCount,
        description: blindSpec.shortDescription,
        gasketDescription: gasketSpec?.shortDescription,
        gasketThicknessMm: gasketSpec?.gasketThicknessMm,
        boltSetDescription: boltSetSpec?.shortDescription,
        boltSize: boltSetSpec?.boltSize || (nd >= 4 ? '5/8"' : '1/2"'),
        boltCount,
        boltLengthMm: boltSetSpec?.boltLengthMm,
        ...this.specParameters(blindSpec),
        skey: blindSpec.skey || 'FLBL'
      }
    };
    this.addComponent(blind);
    this.connectPorts(face.id, port1.id, undefined, { gapMm: gap });
    return { blind, flange };
  }

  /** Cupla de la spec en un puerto abierto: une dos caños en línea (socket o rosca) */
  public addCoupling(port: Port, couplingSpec: SpecFitting): Component {
    const compId = this.generateId('cpl');
    const span = Math.max(0, couplingSpec.faceToFace ?? 0);
    const dir = port.direction.clone().normalize();
    const p1 = port.position.clone();
    const p2 = p1.clone().addScaledVector(dir, span);
    const port1 = this.portFromSpec(compId, 1, p1, dir.clone().negate(), couplingSpec, 0);
    const port2 = this.portFromSpec(compId, 2, p2, dir, couplingSpec, 1);
    const component: Component = {
      id: compId,
      type: 'COUPLING',
      specCode: couplingSpec.specCode,
      catalogId: String(couplingSpec.pnpid),
      ports: [port1, port2],
      centerline: [p1.clone(), p2.clone()],
      parameters: {
        nominalDiameter: couplingSpec.nominalDiameter,
        outerDiameter: couplingSpec.outerDiameter,
        wallThickness: couplingSpec.wallThickness,
        schedule: couplingSpec.schedule,
        faceToFace: span,
        description: couplingSpec.shortDescription,
        ...this.specParameters(couplingSpec)
      }
    };
    this.addComponent(component);
    this.connectPorts(port.id, port1.id);
    return component;
  }

  /**
   * Inserta una tapa (CAP) en un puerto abierto (cierre de línea)
   */
  public addCap(port: Port, capSpec: SpecFitting): Component {
    const compId = this.generateId('cap');
    const H = capSpec.faceToFace || 38.1;

    const p1 = port.position.clone();
    const p2 = p1.clone().add(port.direction.clone().multiplyScalar(H));
    const port1 = this.portFromSpec(compId, 1, p1, port.direction.clone().negate(), capSpec, 0);

    const component: Component = {
      id: compId,
      type: 'CAP',
      specCode: capSpec.specCode,
      catalogId: String(capSpec.pnpid),
      ports: [port1],
      centerline: [p1.clone(), p2.clone()],
      parameters: {
        nominalDiameter: capSpec.nominalDiameter,
        outerDiameter: capSpec.outerDiameter,
        wallThickness: capSpec.wallThickness,
        schedule: capSpec.schedule,
        faceToFace: H,
        description: capSpec.shortDescription,
        ...this.specParameters(capSpec)
      }
    };

    this.addComponent(component);
    this.connectPorts(port.id, port1.id);
    return component;
  }

  /**
   * Marca una soldadura como de campo (FW), de campo con sobrelargo (FFW) o de taller (null).
   * Las de campo cortan el spool; el sobrelargo se suma al corte del caño.
   */
  public setFieldWeld(jointId: string, kind: FieldWeldKind | null, allowanceMm = 100): Joint | null {
    const joint = this.joints.get(jointId);
    if (!joint || joint.type === 'FLANGED') return null;
    joint.fieldWeld = kind ?? undefined;
    joint.fieldAllowanceMm = kind === 'FFW' ? allowanceMm : undefined;
    return joint;
  }

  /** Un tramo que sale de partir un caño conserva su spec, línea, descripción y bloque PCF de origen */
  private inheritPipeIdentity(from: Component, to: Component): void {
    to.specCode = from.specCode;
    const p = from.parameters;
    if (p.description) to.parameters.description = p.description;
    if (p.lineNumber) to.parameters.lineNumber = p.lineNumber;
    if (p.itemCode) to.parameters.itemCode = p.itemCode;
    if (p.pcf) to.parameters.pcf = p.pcf;
  }

  /**
   * Obtiene todos los puertos libres (sin conectar)
   */
  public getOpenPorts(): Port[] {
    const open: Port[] = [];
    for (const port of this.ports.values()) {
      if (!port.connectedJointId) {
        open.push(port);
      }
    }
    return open;
  }

  /**
   * Calcula el Cómputo y Presupuesto / Lista de Materiales (BOM)
   * Incluye automáticamente las Juntas (Gasket) y Juegos de Espárragos (BoltSet)
   * según las reglas P3dJoint de AutoCAD Plant 3D (ConnectionManager).
   */
  public calculateBillOfMaterials(): {
    type: ComponentType;
    nominalDiameter: number;
    description: string;
    quantity: number;
    totalCutLengthMm: number;
  }[] {
    const map = new Map<
      string,
      {
        type: ComponentType;
        nominalDiameter: number;
        description: string;
        quantity: number;
        totalCutLengthMm: number;
      }
    >();

    const addItem = (
      type: ComponentType,
      nominalDiameter: number,
      description: string,
      qty: number,
      cutLenMm: number = 0
    ) => {
      const key = `${type}_${nominalDiameter}_${description}`;
      const existing = map.get(key);
      if (existing) {
        existing.quantity += qty;
        existing.totalCutLengthMm += cutLenMm;
      } else {
        map.set(key, {
          type,
          nominalDiameter,
          description,
          quantity: qty,
          totalCutLengthMm: cutLenMm
        });
      }
    };

    for (const comp of this.components.values()) {
      const nd = comp.parameters.nominalDiameter;
      const cutLen = comp.parameters.cutLength || 0;
      const desc = comp.parameters.description || `${comp.type} ND ${nd}"`;
      addItem(comp.type, nd, desc, 1, cutLen);
    }

    // Juntas y bulones: uno por cada unión bridada (regla Flanged / Lug / Wafer de Plant 3D)
    for (const joint of this.joints.values()) {
      if (joint.type !== 'FLANGED') continue;
      const pa = this.ports.get(joint.portAId);
      const pb = this.ports.get(joint.portBId);
      const comps = [pa, pb].map((pp) => (pp ? this.components.get(pp.componentId) : undefined));
      const src = comps.find((c) => c?.parameters.gasketDescription) || comps.find(Boolean);
      const nd = pa?.nominalDiameter || pb?.nominalDiameter || src?.parameters.nominalDiameter || 2;
      const cls = pa?.pressureClass || pb?.pressureClass || '150';
      const bolts = src?.parameters.boltCount || (nd >= 4 ? 8 : 4);
      const boltSize = src?.parameters.boltSize || (nd >= 4 ? '5/8"' : '1/2"');
      addItem('GASKET', nd, src?.parameters.gasketDescription || `GASKET ${cls} LB ND ${nd}" (genérica)`, 1, 0);
      addItem(
        'BOLT_SET',
        nd,
        src?.parameters.boltSetDescription || `BOLT SET ${cls} LB (${bolts}x ${boltSize}, genérico)`,
        1,
        0
      );
    }

    return Array.from(map.values());
  }

  /**
   * Determina la preparación física de un extremo de niple (Plano, Bisel, Roscado)
   * según la junta/accesorio conectado o la selección manual del usuario.
   */
  public resolvePortEndFinish(port?: Port, customOverride?: NippleEndFinish): NippleEndFinish {
    if (customOverride) return customOverride;
    if (!port) return 'Plano';
    if (port.endType === 'THD') return 'Roscado';
    if (port.endType === 'SW') return 'Plano';
    if (port.connectedJointId) {
      const joint = this.joints.get(port.connectedJointId);
      if (joint) {
        if (joint.type === 'THREADED') return 'Roscado';
        // Socket, slip-on, pegado y termofusión llevan el caño con extremo plano
        if (joint.type === 'SOCKETWELD' || joint.type === 'SLIPON' || joint.type === 'GLUE' || joint.type === 'FUSION') return 'Plano';
        if (joint.type === 'BUTTWELD') return 'Bisel';
      }
    }
    const pe = (port.plantEndType || '').toUpperCase();
    if (pe === 'PL' || pe === 'PPL') return 'Plano';
    if (pe.startsWith('THD')) return 'Roscado';
    return port.connectedJointId ? 'Bisel' : 'Plano';
  }

  /**
   * Calcula el listado individual de cortes de cañería (Lista de Cortes de Niples / Spool List)
   * Incluye Identificación (N-01, N-02...), Largo en mm y los dos Tipos de Extremos (Plano, Bisel, Roscado).
   */
  public calculatePipeCutList(): {
    itemNumber: number;
    nippleId: string;
    componentId: string;
    lineNumber: string;
    nominalDiameter: number;
    outerDiameter: number;
    schedule: string;
    description: string;
    grossLengthMm: number;
    cutLengthMm: number;
    endFinish1: NippleEndFinish;
    endFinish2: NippleEndFinish;
  }[] {
    const cuts: {
      itemNumber: number;
      nippleId: string;
      componentId: string;
      lineNumber: string;
      nominalDiameter: number;
      outerDiameter: number;
      schedule: string;
      description: string;
      grossLengthMm: number;
      cutLengthMm: number;
      endFinish1: NippleEndFinish;
      endFinish2: NippleEndFinish;
    }[] = [];

    let idx = 1;
    for (const comp of this.components.values()) {
      if (comp.type === 'PIPE') {
        const gross =
          comp.parameters.grossLength ||
          (comp.centerline.length >= 2 ? comp.centerline[0].distanceTo(comp.centerline[1]) : 0);
        const net = comp.parameters.cutLength !== undefined ? comp.parameters.cutLength : gross;
        const num = idx++;
        const nippleId = comp.parameters.nippleTag || `N-${String(num).padStart(2, '0')}`;
        const endFinish1 = this.resolvePortEndFinish(comp.ports[0], comp.parameters.endFinish1);
        const endFinish2 = this.resolvePortEndFinish(comp.ports[1], comp.parameters.endFinish2);

        cuts.push({
          itemNumber: num,
          nippleId,
          componentId: comp.id,
          lineNumber: comp.parameters.lineNumber || this.activeLineNumber || `${this.activeSpec}-${comp.parameters.nominalDiameter}"`,
          nominalDiameter: comp.parameters.nominalDiameter,
          outerDiameter: comp.parameters.outerDiameter,
          schedule: comp.parameters.schedule || 'SCH 40',
          description: comp.parameters.description || `PIPE ND ${comp.parameters.nominalDiameter}"`,
          grossLengthMm: gross,
          cutLengthMm: net,
          endFinish1,
          endFinish2
        });
      }
    }
    return cuts;
  }

  /**
   * Ejecuta un comando con soporte de Deshacer / Rehacer transaccional
   */
  public executeCommand(command: GraphCommand): void {
    command.execute();
    this.undoStack.push(command);
    this.redoStack = [];
  }

  /**
   * Deshace la última acción del grafo
   */
  public undo(): boolean {
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    cmd.undo();
    this.redoStack.push(cmd);
    return true;
  }

  /**
   * Rehace la última acción deshecha
   */
  public redo(): boolean {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    cmd.execute();
    this.undoStack.push(cmd);
    return true;
  }

  /**
   * Serializa el estado completo del grafo a un objeto plano JSON (para IndexedDB)
   */
  public serialize(): SerializedGraphState {
    const serializedComponents: Record<string, SerializedComponent> = {};
    for (const [id, comp] of this.components.entries()) {
      serializedComponents[id] = {
        id: comp.id,
        type: comp.type,
        specCode: comp.specCode,
        catalogId: comp.catalogId,
        ports: comp.ports.map((p): SerializedPort => ({
          id: p.id,
          componentId: p.componentId,
          index: p.index,
          position: [p.position.x, p.position.y, p.position.z],
          direction: [p.direction.x, p.direction.y, p.direction.z],
          nominalDiameter: p.nominalDiameter,
          outerDiameter: p.outerDiameter,
          wallThickness: p.wallThickness,
          schedule: p.schedule,
          endType: p.endType,
          plantEndType: p.plantEndType,
          pressureClass: p.pressureClass,
          connectedJointId: p.connectedJointId
        })),
        centerline: comp.centerline.map(c => [c.x, c.y, c.z]),
        parameters: { ...comp.parameters }
      };
    }

    const serializedJoints: Record<string, SerializedJoint> = {};
    for (const [id, j] of this.joints.entries()) {
      serializedJoints[id] = {
        id: j.id,
        type: j.type,
        portAId: j.portAId,
        portBId: j.portBId,
        position: [j.position.x, j.position.y, j.position.z],
        gapMm: j.gapMm,
        plantJoint: j.plantJoint,
        fieldWeld: j.fieldWeld,
        fieldAllowanceMm: j.fieldAllowanceMm
      };
    }

    return {
      version: 1,
      activeSpec: this.activeSpec,
      currentNominalDiameter: this.currentNominalDiameter,
      currentSchedule: this.currentSchedule,
      components: serializedComponents,
      joints: serializedJoints,
      activeLineNumber: this.activeLineNumber,
      pcf: this.pcfInfo,
      supports: [...this.supports.values()].map((s) => ({
        id: s.id,
        kind: s.kind,
        position: [s.position.x, s.position.y, s.position.z],
        nominalDiameter: s.nominalDiameter,
        tag: s.tag,
        plantType: s.plantType,
        heightMm: s.heightMm,
        rotationDeg: s.rotationDeg
      }))
    };
  }

  /**
   * Restaura el grafo a partir de un estado serializado de IndexedDB
   */
  public deserialize(state: SerializedGraphState): void {
    this.components.clear();
    this.joints.clear();
    this.ports.clear();

    this.activeSpec = state.activeSpec;
    this.currentNominalDiameter = state.currentNominalDiameter;
    this.currentSchedule = state.currentSchedule;
    if (state.activeLineNumber) this.activeLineNumber = state.activeLineNumber;
    this.pcfInfo = state.pcf;
    this.supports.clear();
    for (const s of state.supports ?? []) {
      this.supports.set(s.id, {
        id: s.id,
        kind: s.kind,
        position: new THREE.Vector3(...s.position),
        nominalDiameter: s.nominalDiameter,
        tag: s.tag,
        plantType: s.plantType,
        heightMm: s.heightMm,
        rotationDeg: s.rotationDeg
      });
    }

    for (const sComp of Object.values(state.components)) {
      const comp: Component = {
        id: sComp.id,
        type: sComp.type,
        specCode: sComp.specCode,
        catalogId: sComp.catalogId,
        ports: sComp.ports.map((sp): Port => {
          const port: Port = {
            id: sp.id,
            componentId: sp.componentId,
            index: sp.index,
            position: new THREE.Vector3(...sp.position),
            direction: new THREE.Vector3(...sp.direction),
            nominalDiameter: sp.nominalDiameter,
            outerDiameter: sp.outerDiameter,
            wallThickness: sp.wallThickness,
            schedule: sp.schedule,
            endType: sp.endType,
            plantEndType: sp.plantEndType,
            pressureClass: sp.pressureClass,
            connectedJointId: sp.connectedJointId
          };
          this.ports.set(port.id, port);
          return port;
        }),
        centerline: sComp.centerline.map(c => new THREE.Vector3(...c)),
        parameters: { ...sComp.parameters }
      };
      this.components.set(comp.id, comp);
    }

    for (const sJ of Object.values(state.joints)) {
      const joint: Joint = {
        id: sJ.id,
        type: sJ.type,
        portAId: sJ.portAId,
        portBId: sJ.portBId,
        position: new THREE.Vector3(...sJ.position),
        gapMm: sJ.gapMm,
        plantJoint: sJ.plantJoint,
        fieldWeld: sJ.fieldWeld,
        fieldAllowanceMm: sJ.fieldAllowanceMm
      };
      this.joints.set(joint.id, joint);
    }
  }
}
