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
  ElbowPlacementResult
} from '../../types/piping';
import { calculateElbowPlacement, validateOpposedPorts, EPSILON } from '../math/elbowSolver';

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
  public connectPorts(portAId: string, portBId: string, jointType: JointType = 'BUTTWELD'): Joint {
    const portA = this.ports.get(portAId);
    const portB = this.ports.get(portBId);

    if (!portA || !portB) {
      throw new Error(`Uno o ambos puertos no existen: ${portAId}, ${portBId}`);
    }

    if (portA.connectedJointId || portB.connectedJointId) {
      throw new Error(`Uno de los puertos ya está conectado a otra junta.`);
    }

    // Validación de coincidencia espacial (en milímetros)
    const dist = portA.position.distanceTo(portB.position);
    if (dist > 1.0) {
      throw new Error(
        `Los puertos no coinciden en posición espacial: distancia = ${dist.toFixed(2)} mm (máx permitido 1.0 mm).`
      );
    }

    // Validación de normales opuestas (u1 · u2 ≈ -1)
    if (!validateOpposedPorts(portA.direction, portB.direction, 5.0)) {
      throw new Error(
        `Los puertos no están enfrentados en dirección opuesta (u1 · u2 = ${portA.direction.dot(portB.direction).toFixed(3)}).`
      );
    }

    const jointId = this.generateId('jnt');
    const joint: Joint = {
      id: jointId,
      type: jointType,
      portAId: portA.id,
      portBId: portB.id,
      position: portA.position.clone()
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

    const port1: Port = {
      id: port1Id,
      componentId: compId,
      index: 1,
      position: start.clone(),
      direction: dir1,
      nominalDiameter: fittingSpec.nominalDiameter,
      outerDiameter: fittingSpec.outerDiameter,
      wallThickness: fittingSpec.wallThickness,
      schedule: fittingSpec.schedule,
      endType: fittingSpec.endType
    };

    const port2: Port = {
      id: port2Id,
      componentId: compId,
      index: 2,
      position: end.clone(),
      direction: dir2,
      nominalDiameter: fittingSpec.nominalDiameter,
      outerDiameter: fittingSpec.outerDiameter,
      wallThickness: fittingSpec.wallThickness,
      schedule: fittingSpec.schedule,
      endType: fittingSpec.endType
    };

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
        description: fittingSpec.shortDescription
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

    const port1: Port = {
      id: port1Id,
      componentId: compId,
      index: 1,
      position: placement.cutPoint1.clone(),
      direction: dir1,
      nominalDiameter: elbowSpec.nominalDiameter,
      outerDiameter: elbowSpec.outerDiameter,
      wallThickness: elbowSpec.wallThickness,
      schedule: elbowSpec.schedule,
      endType: elbowSpec.endType
    };

    const port2: Port = {
      id: port2Id,
      componentId: compId,
      index: 2,
      position: placement.cutPoint2.clone(),
      direction: dir2,
      nominalDiameter: elbowSpec.nominalDiameter,
      outerDiameter: elbowSpec.outerDiameter,
      wallThickness: elbowSpec.wallThickness,
      schedule: elbowSpec.schedule,
      endType: elbowSpec.endType
    };

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
        matrixElements: Array.from(placement.matrix.elements)
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
    const jointIn = this.connectPorts(incomingPipe.ports[1].id, elbow.ports[0].id, 'BUTTWELD');

    // 6. Unir codo (puerto 2) con cañería saliente (puerto 1)
    const jointOut = this.connectPorts(elbow.ports[1].id, outgoingPipe.ports[0].id, 'BUTTWELD');

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
   * Inserta una brida (FLANGE) en un puerto abierto aplicando reglas P3dJoint (Gasket + BoltSet)
   */
  public addFlange(
    port: Port,
    flangeSpec: SpecFitting,
    gasketSpec?: SpecFitting | null,
    boltSetSpec?: SpecFitting | null
  ): Component {
    const compId = this.generateId('flg');
    const port1Id = this.generateId('prt');
    const port2Id = this.generateId('prt');
    const L = flangeSpec.faceToFace || 63.5;

    const p1 = port.position.clone();
    const p2 = p1.clone().add(port.direction.clone().multiplyScalar(L));

    const port1: Port = {
      id: port1Id,
      componentId: compId,
      index: 1,
      position: p1.clone(),
      direction: port.direction.clone().negate(),
      nominalDiameter: flangeSpec.nominalDiameter,
      outerDiameter: flangeSpec.outerDiameter,
      wallThickness: flangeSpec.wallThickness,
      schedule: flangeSpec.schedule,
      endType: flangeSpec.endType
    };

    const port2: Port = {
      id: port2Id,
      componentId: compId,
      index: 2,
      position: p2.clone(),
      direction: port.direction.clone(),
      nominalDiameter: flangeSpec.nominalDiameter,
      outerDiameter: flangeSpec.outerDiameter,
      wallThickness: flangeSpec.wallThickness,
      schedule: flangeSpec.schedule,
      endType: 'FLANG'
    };

    const nd = flangeSpec.nominalDiameter;
    const defaultBoltCount = flangeSpec.boltHoles || (nd >= 4 ? 8 : 4);
    const defaultBoltSize = nd >= 4 ? '5/8"' : '1/2"';

    const component: Component = {
      id: compId,
      type: 'FLANGE',
      specCode: flangeSpec.specCode,
      catalogId: String(flangeSpec.pnpid),
      ports: [port1, port2],
      centerline: [p1.clone(), p2.clone()],
      parameters: {
        nominalDiameter: flangeSpec.nominalDiameter,
        outerDiameter: flangeSpec.outerDiameter,
        wallThickness: flangeSpec.wallThickness,
        schedule: flangeSpec.schedule,
        faceToFace: L,
        boltCircle: flangeSpec.boltCircle || flangeSpec.outerDiameter * 1.3,
        boltHoles: boltSetSpec?.boltCount || defaultBoltCount,
        description: flangeSpec.shortDescription,
        gasketDescription:
          gasketSpec?.shortDescription || `GASKET, 150 LB, CS/PTFE ASME B16.21 ND ${nd}"`,
        gasketThicknessMm: gasketSpec?.gasketThicknessMm || 1.59,
        boltSetDescription:
          boltSetSpec?.shortDescription ||
          `BOLT SET, RF, 150 LB (${defaultBoltCount}x ${defaultBoltSize} Stud Bolt ASTM A193 B7)`,
        boltSize: boltSetSpec?.boltSize || defaultBoltSize,
        boltCount: boltSetSpec?.boltCount || defaultBoltCount,
        boltLengthMm: boltSetSpec?.boltLengthMm || 70
      }
    };

    this.addComponent(component);
    const jointType: JointType = port.endType === 'FLANG' ? 'FLANGED' : 'BUTTWELD';
    this.connectPorts(port.id, port1.id, jointType);
    return component;
  }

  /**
   * Inserta una válvula industrial (VALVE) en un puerto abierto aplicando reglas P3dJoint (Gasket + BoltSet)
   */
  public addValve(
    port: Port,
    valveSpec: SpecFitting,
    gasketSpec?: SpecFitting | null,
    boltSetSpec?: SpecFitting | null
  ): Component {
    const compId = this.generateId('vlv');
    const port1Id = this.generateId('prt');
    const port2Id = this.generateId('prt');
    const L = valveSpec.faceToFace || 178.0;

    const p1 = port.position.clone();
    const p2 = p1.clone().add(port.direction.clone().multiplyScalar(L));

    const port1: Port = {
      id: port1Id,
      componentId: compId,
      index: 1,
      position: p1.clone(),
      direction: port.direction.clone().negate(),
      nominalDiameter: valveSpec.nominalDiameter,
      outerDiameter: valveSpec.outerDiameter,
      wallThickness: valveSpec.wallThickness,
      schedule: valveSpec.schedule,
      endType: 'FLANG'
    };

    const port2: Port = {
      id: port2Id,
      componentId: compId,
      index: 2,
      position: p2.clone(),
      direction: port.direction.clone(),
      nominalDiameter: valveSpec.nominalDiameter,
      outerDiameter: valveSpec.outerDiameter,
      wallThickness: valveSpec.wallThickness,
      schedule: valveSpec.schedule,
      endType: 'FLANG'
    };

    const nd = valveSpec.nominalDiameter;
    const defaultBoltCount = valveSpec.boltHoles || (nd >= 4 ? 8 : 4);
    const defaultBoltSize = nd >= 4 ? '5/8"' : '1/2"';

    const component: Component = {
      id: compId,
      type: 'VALVE',
      specCode: valveSpec.specCode,
      catalogId: String(valveSpec.pnpid),
      ports: [port1, port2],
      centerline: [p1.clone(), p2.clone()],
      parameters: {
        nominalDiameter: valveSpec.nominalDiameter,
        outerDiameter: valveSpec.outerDiameter,
        wallThickness: valveSpec.wallThickness,
        schedule: valveSpec.schedule,
        faceToFace: L,
        boltCircle: valveSpec.boltCircle || valveSpec.outerDiameter * 1.3,
        boltHoles: boltSetSpec?.boltCount || defaultBoltCount,
        description: valveSpec.shortDescription,
        gasketDescription:
          gasketSpec?.shortDescription || `GASKET, 150 LB, CS/PTFE ASME B16.21 ND ${nd}"`,
        gasketThicknessMm: gasketSpec?.gasketThicknessMm || 1.59,
        boltSetDescription:
          boltSetSpec?.shortDescription ||
          `BOLT SET, RF, 150 LB (${defaultBoltCount}x ${defaultBoltSize} Stud Bolt ASTM A193 B7)`,
        boltSize: boltSetSpec?.boltSize || defaultBoltSize,
        boltCount: boltSetSpec?.boltCount || defaultBoltCount,
        boltLengthMm: boltSetSpec?.boltLengthMm || 70
      }
    };

    this.addComponent(component);
    const jointType: JointType = port.endType === 'FLANG' ? 'FLANGED' : 'BUTTWELD';
    this.connectPorts(port.id, port1.id, jointType);
    return component;
  }

  /**
   * Inserta una Te igual (TEE) en un puerto abierto garantizando ortogonalidad de 90° en la derivación
   */
  public addTee(port: Port, branchDir: THREE.Vector3, teeSpec: SpecFitting): Component {
    const compId = this.generateId('tee');
    const port1Id = this.generateId('prt');
    const port2Id = this.generateId('prt');
    const port3Id = this.generateId('prt');

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

    const port1: Port = {
      id: port1Id,
      componentId: compId,
      index: 1,
      position: p1.clone(),
      direction: uRun.clone().negate(),
      nominalDiameter: teeSpec.nominalDiameter,
      outerDiameter: teeSpec.outerDiameter,
      wallThickness: teeSpec.wallThickness,
      schedule: teeSpec.schedule,
      endType: teeSpec.endType
    };

    const port2: Port = {
      id: port2Id,
      componentId: compId,
      index: 2,
      position: p2.clone(),
      direction: uRun.clone(),
      nominalDiameter: teeSpec.nominalDiameter,
      outerDiameter: teeSpec.outerDiameter,
      wallThickness: teeSpec.wallThickness,
      schedule: teeSpec.schedule,
      endType: teeSpec.endType
    };

    const port3: Port = {
      id: port3Id,
      componentId: compId,
      index: 3,
      position: p3.clone(),
      direction: bDir.clone(),
      nominalDiameter: teeSpec.nominalDiameter,
      outerDiameter: teeSpec.outerDiameter,
      wallThickness: teeSpec.wallThickness,
      schedule: teeSpec.schedule,
      endType: teeSpec.endType
    };

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
        description: teeSpec.shortDescription
      }
    };

    this.addComponent(component);
    this.connectPorts(port.id, port1.id, 'BUTTWELD');
    return component;
  }

  /**
   * Rota el ramal de una Te (TEE) o la salida de un Codo (ELBOW) alrededor de su eje de entrada
   */
  public rotateComponentAroundRun(componentId: string, angleDeg: number = 90): Component | null {
    const comp = this.components.get(componentId);
    if (!comp) return null;

    const rad = THREE.MathUtils.degToRad(angleDeg);

    if (comp.type === 'TEE' && comp.ports.length >= 3 && comp.centerline.length >= 4) {
      const portBranch = comp.ports[2];
      if (portBranch.connectedJointId) {
        throw new Error('No se puede girar el ramal de la Te porque ya tiene una cañería conectada.');
      }
      const uRun = comp.ports[1].direction.clone().normalize();
      const vertex = comp.centerline[1].clone();
      const M = comp.parameters.branchTakeOff || vertex.distanceTo(portBranch.position) || 63.5;

      const newBranchDir = portBranch.direction.clone().applyAxisAngle(uRun, rad).normalize();
      const newP3 = vertex.clone().add(newBranchDir.clone().multiplyScalar(M));

      portBranch.direction.copy(newBranchDir);
      portBranch.position.copy(newP3);
      comp.centerline[3].copy(newP3);
      return comp;
    }

    if (comp.type === 'ELBOW' && comp.ports.length >= 2) {
      const portOut = comp.ports[1];
      if (portOut.connectedJointId) {
        throw new Error('No se puede girar el codo porque su salida ya está conectada.');
      }
      const p1 = comp.ports[0].position.clone();
      const uIn = comp.ports[0].direction.clone().negate().normalize();
      const takeOff = comp.parameters.takeOff || comp.parameters.radius || 76.2;
      const vertex = p1.clone().add(uIn.clone().multiplyScalar(takeOff));
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
   * Modifica la longitud de un tramo de caño existente (PIPE) si tiene al menos un extremo libre
   */
  public updatePipeLength(componentId: string, newLengthMm: number): Component | null {
    const comp = this.components.get(componentId);
    if (!comp || comp.type !== 'PIPE' || newLengthMm <= 10 || comp.ports.length < 2) return null;

    const port1 = comp.ports[0];
    const port2 = comp.ports[1];

    if (!port2.connectedJointId) {
      // Extremo 2 libre: mover puerto 2 a lo largo de la dirección del caño
      const dir = port2.direction.clone().normalize();
      const newEnd = port1.position.clone().add(dir.multiplyScalar(newLengthMm));
      port2.position.copy(newEnd);
      comp.centerline[1].copy(newEnd);
      comp.parameters.cutLength = newLengthMm;
      comp.parameters.grossLength = newLengthMm;
      return comp;
    } else if (!port1.connectedJointId) {
      // Extremo 1 libre: mover puerto 1
      const dir = port1.direction.clone().normalize();
      const newStart = port2.position.clone().add(dir.multiplyScalar(newLengthMm));
      port1.position.copy(newStart);
      comp.centerline[0].copy(newStart);
      comp.parameters.cutLength = newLengthMm;
      comp.parameters.grossLength = newLengthMm;
      return comp;
    } else {
      // Ambos extremos conectados: actualizar longitud declarada de corte
      comp.parameters.cutLength = newLengthMm;
      return comp;
    }
  }

  /**
   * Inserta una reducción concéntrica (REDUCER) en un puerto abierto
   */
  public addReducer(port: Port, reducerSpec: SpecFitting): Component {
    const compId = this.generateId('red');
    const port1Id = this.generateId('prt');
    const port2Id = this.generateId('prt');
    const L = reducerSpec?.faceToFace || 88.9;

    const p1 = port.position.clone();
    const p2 = p1.clone().add(port.direction.clone().multiplyScalar(L));

    const nd1 = reducerSpec?.nominalDiameter || port.nominalDiameter;
    const od1 = reducerSpec?.outerDiameter || port.outerDiameter;
    const wt = reducerSpec?.wallThickness || port.wallThickness;
    const sch = reducerSpec?.schedule || port.schedule;
    const endType = reducerSpec?.endType || 'BUTTWELD';

    const targetND = reducerSpec?.reducedNominalDiameter || (nd1 > 1 ? nd1 - 1 : 2);
    const targetOD = reducerSpec?.reducedOuterDiameter || (targetND * 25.4);

    const port1: Port = {
      id: port1Id,
      componentId: compId,
      index: 1,
      position: p1.clone(),
      direction: port.direction.clone().negate(),
      nominalDiameter: nd1,
      outerDiameter: od1,
      wallThickness: wt,
      schedule: sch,
      endType: endType
    };

    const port2: Port = {
      id: port2Id,
      componentId: compId,
      index: 2,
      position: p2.clone(),
      direction: port.direction.clone(),
      nominalDiameter: targetND,
      outerDiameter: targetOD,
      wallThickness: wt,
      schedule: sch,
      endType: endType
    };

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
        wallThickness: wt,
        schedule: sch,
        faceToFace: L,
        description: reducerSpec?.shortDescription || `Reducción ${nd1}"x${targetND}"`
      }
    };

    this.addComponent(component);
    this.connectPorts(port.id, port1.id, 'BUTTWELD');
    return component;
  }

  /**
   * Inserta una tapa / casquete (CAP) en un puerto abierto (cierre de línea)
   */
  public addCap(port: Port, capSpec: SpecFitting): Component {
    const compId = this.generateId('cap');
    const port1Id = this.generateId('prt');
    const H = capSpec.faceToFace || 38.1;

    const p1 = port.position.clone();
    const p2 = p1.clone().add(port.direction.clone().multiplyScalar(H));

    const port1: Port = {
      id: port1Id,
      componentId: compId,
      index: 1,
      position: p1.clone(),
      direction: port.direction.clone().negate(),
      nominalDiameter: capSpec.nominalDiameter,
      outerDiameter: capSpec.outerDiameter,
      wallThickness: capSpec.wallThickness,
      schedule: capSpec.schedule,
      endType: capSpec.endType
    };

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
        description: capSpec.shortDescription
      }
    };

    this.addComponent(component);
    this.connectPorts(port.id, port1.id, 'BUTTWELD');
    return component;
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

      // Regla P3dJoint (Autodesk.ProcessPower.P3dConnectionManager):
      // Bridas (FLANGE) requieren 1 Junta (Gasket) + 1 Juego de Espárragos (BoltSet).
      // Válvulas bridadas (VALVE) requieren 2 Juntas + 2 Juegos de Espárragos (1 por cada cara bridada).
      if (comp.type === 'FLANGE' || comp.type === 'VALVE') {
        const flangedFaces = comp.type === 'VALVE' ? 2 : 1;
        const defaultBolts = comp.parameters.boltCount || comp.parameters.boltHoles || (nd >= 4 ? 8 : 4);
        const defaultBoltSize = comp.parameters.boltSize || (nd >= 4 ? '5/8"' : '1/2"');

        const gasketDesc =
          comp.parameters.gasketDescription || `GASKET, 150 LB, CS/PTFE ASME B16.21 ND ${nd}"`;
        const boltDesc =
          comp.parameters.boltSetDescription ||
          `BOLT SET, RF, 150 LB (${defaultBolts}x ${defaultBoltSize} Stud Bolt ASTM A193 B7)`;

        addItem('GASKET', nd, gasketDesc, flangedFaces, 0);
        addItem('BOLT_SET', nd, boltDesc, flangedFaces, 0);
      }
    }

    return Array.from(map.values());
  }

  /**
   * Calcula el listado individual de cortes de cañería (Pipe Cut List / Spool List)
   */
  public calculatePipeCutList(): {
    itemNumber: number;
    componentId: string;
    nominalDiameter: number;
    outerDiameter: number;
    schedule: string;
    description: string;
    grossLengthMm: number;
    cutLengthMm: number;
  }[] {
    const cuts: {
      itemNumber: number;
      componentId: string;
      nominalDiameter: number;
      outerDiameter: number;
      schedule: string;
      description: string;
      grossLengthMm: number;
      cutLengthMm: number;
    }[] = [];

    let idx = 1;
    for (const comp of this.components.values()) {
      if (comp.type === 'PIPE') {
        const gross =
          comp.parameters.grossLength ||
          (comp.centerline.length >= 2 ? comp.centerline[0].distanceTo(comp.centerline[1]) : 0);
        const net = comp.parameters.cutLength !== undefined ? comp.parameters.cutLength : gross;
        cuts.push({
          itemNumber: idx++,
          componentId: comp.id,
          nominalDiameter: comp.parameters.nominalDiameter,
          outerDiameter: comp.parameters.outerDiameter,
          schedule: comp.parameters.schedule || 'SCH 40',
          description: comp.parameters.description || `PIPE ND ${comp.parameters.nominalDiameter}"`,
          grossLengthMm: gross,
          cutLengthMm: net
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
        position: [j.position.x, j.position.y, j.position.z]
      };
    }

    return {
      version: 1,
      activeSpec: this.activeSpec,
      currentNominalDiameter: this.currentNominalDiameter,
      currentSchedule: this.currentSchedule,
      components: serializedComponents,
      joints: serializedJoints
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
        position: new THREE.Vector3(...sJ.position)
      };
      this.joints.set(joint.id, joint);
    }
  }
}
