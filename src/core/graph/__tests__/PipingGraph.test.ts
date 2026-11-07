import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { PipingGraph } from '../PipingGraph';
import { SpecDatabaseReader } from '../../specs/SpecDatabaseReader';
import { calculateElbowPlacement } from '../../math/elbowSolver';
import { PcfExporter } from '../../exporters/PcfExporter';
import { PcfImporter } from '../../importers/PcfImporter';

describe('PipingGraph - Grafo Topológico y Ruteo de Cañerías', () => {
  let reader: SpecDatabaseReader;

  beforeAll(async () => {
    reader = await SpecDatabaseReader.create();
  });

  it('Debe rutar un tramo de 1000mm en +X girando hacia +Y con codo 2" y recalcular cortes netos', () => {
    const graph = new PipingGraph('CS150', 2, 'SCH 40');
    const pipeSpec = reader.findPipe(2, 'CS150')!;
    const elbowSpec = reader.findElbow(2, 90, 'CS150')!;

    expect(pipeSpec).toBeDefined();
    expect(elbowSpec).toBeDefined();

    const pStart = new THREE.Vector3(0, 0, 0);
    const vertex = new THREE.Vector3(1000, 0, 0);
    const pNext = new THREE.Vector3(1000, 1000, 0);

    const result = graph.routeTurnWithElbow(pStart, vertex, pNext, pipeSpec, elbowSpec);

    // Verificación de componentes generados
    expect(result.incomingPipe).toBeDefined();
    expect(result.elbow).toBeDefined();
    expect(result.outgoingPipe).toBeDefined();

    // Verificación de longitud neta de corte
    expect(result.incomingPipe.parameters.cutLength).toBeCloseTo(923.8, 4);
    expect(result.outgoingPipe.parameters.cutLength).toBeCloseTo(923.8, 4);

    // Verificación de juntas
    expect(result.jointIn).toBeDefined();
    expect(result.jointOut).toBeDefined();

    // Verificar que los puertos conectados tengan normales opuestas u1 · u2 = -1
    const pPipeOut = result.incomingPipe.ports[1];
    const pElbowIn = result.elbow.ports[0];
    expect(pPipeOut.direction.dot(pElbowIn.direction)).toBeCloseTo(-1.0, 4);

    const pElbowOut = result.elbow.ports[1];
    const pPipeIn = result.outgoingPipe.ports[0];
    expect(pElbowOut.direction.dot(pPipeIn.direction)).toBeCloseTo(-1.0, 4);

    // Total de componentes en el grafo: 2 caños + 1 codo = 3
    expect(graph.components.size).toBe(3);
    // Total de juntas: 2
    expect(graph.joints.size).toBe(2);
    // Total de puertos abiertos: 2 (el inicio del primer caño y el final del segundo)
    const openPorts = graph.getOpenPorts();
    expect(openPorts.length).toBe(2);
  });

  it('Debe generar el Cómputo de Materiales (BOM) exacto', () => {
    const graph = new PipingGraph('CS150', 2, 'SCH 40');
    const pipeSpec = reader.findPipe(2, 'CS150')!;
    const elbowSpec = reader.findElbow(2, 90, 'CS150')!;

    graph.routeTurnWithElbow(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1000, 0, 0),
      new THREE.Vector3(1000, 1000, 0),
      pipeSpec,
      elbowSpec
    );

    const bom = graph.calculateBillOfMaterials();
    expect(bom.length).toBe(2); // PIPE y ELBOW

    const pipeBOM = bom.find(b => b.type === 'PIPE');
    expect(pipeBOM).toBeDefined();
    expect(pipeBOM?.quantity).toBe(2);
    expect(pipeBOM?.totalCutLengthMm).toBeCloseTo(923.8 * 2, 2);

    const elbowBOM = bom.find(b => b.type === 'ELBOW');
    expect(elbowBOM).toBeDefined();
    expect(elbowBOM?.quantity).toBe(1);
  });

  it('Debe serializar y deserializar el estado del grafo preservando topología', () => {
    const graph = new PipingGraph('CS150', 2, 'SCH 40');
    const pipeSpec = reader.findPipe(2, 'CS150')!;
    const elbowSpec = reader.findElbow(2, 90, 'CS150')!;

    graph.routeTurnWithElbow(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1000, 0, 0),
      new THREE.Vector3(1000, 1000, 0),
      pipeSpec,
      elbowSpec
    );

    const serialized = graph.serialize();
    expect(Object.keys(serialized.components).length).toBe(3);
    expect(Object.keys(serialized.joints).length).toBe(2);

    const restoredGraph = new PipingGraph();
    restoredGraph.deserialize(serialized);

    expect(restoredGraph.components.size).toBe(3);
    expect(restoredGraph.joints.size).toBe(2);
    expect(restoredGraph.getOpenPorts().length).toBe(2);
  });

  it('Debe soportar transacciones Deshacer / Rehacer (Undo / Redo)', () => {
    const graph = new PipingGraph('CS150', 2, 'SCH 40');
    const pipeSpec = reader.findPipe(2, 'CS150')!;

    let createdPipeId = '';
    graph.executeCommand({
      description: 'Agregar caño recto 1000mm',
      execute: () => {
        const pipe = graph.addPipe(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1000, 0, 0), pipeSpec);
        createdPipeId = pipe.id;
      },
      undo: () => {
        graph.removeComponent(createdPipeId);
      }
    });

    expect(graph.components.size).toBe(1);

    // Deshacer
    const undone = graph.undo();
    expect(undone).toBe(true);
    expect(graph.components.size).toBe(0);

    // Rehacer
    const redone = graph.redo();
    expect(redone).toBe(true);
    expect(graph.components.size).toBe(1);
  });

  it('Debe posicionar codo 90° con orientación física correcta al girar de +X hacia +Y en ruteo interactivo', () => {
    const graph = new PipingGraph('CS150', 2, 'SCH 40');
    const pipeSpec = reader.findPipe(2, 'CS150')!;
    const elbowSpec = reader.findElbow(2, 90, 'CS150')!;
    const takeOff = elbowSpec.takeOff!;

    // 1. Tramo inicial de 1000 mm en +X
    const pipe1 = graph.addPipe(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1000, 0, 0), pipeSpec);
    const portPipe1Out = pipe1.ports[1];
    expect(portPipe1Out.position.x).toBeCloseTo(1000, 4);
    expect(portPipe1Out.direction.x).toBeCloseTo(1.0, 4); // Apunta hacia +X

    // 2. Giro hacia +Y de 1000 mm
    const startPoint = portPipe1Out.position.clone();
    const uIn = portPipe1Out.direction.clone().normalize();
    const uOut = new THREE.Vector3(0, 1, 0);
    const vertex = startPoint.clone().add(uIn.clone().multiplyScalar(takeOff));
    const pStart = startPoint.clone();
    const pNext = vertex.clone().add(uOut.clone().multiplyScalar(1000));

    const placement = calculateElbowPlacement(pStart, vertex, pNext, takeOff, elbowSpec.radius);
    const elbow = graph.addElbow(placement, elbowSpec);
    graph.connectPorts(portPipe1Out.id, elbow.ports[0].id, 'BUTTWELD');

    const pipe2 = graph.addPipe(placement.cutPoint2, pNext, pipeSpec, placement.netLengthOutgoing);
    graph.connectPorts(elbow.ports[1].id, pipe2.ports[0].id, 'BUTTWELD');

    // 3. Validar orientación de matriz y vértices
    const matrix = new THREE.Matrix4().fromArray(elbow.parameters.matrixElements!);
    // Puerto 1 del codo en coordenadas locales está en (takeOff, 0, 0)
    const localP1 = new THREE.Vector3(takeOff, 0, 0).applyMatrix4(matrix);
    expect(localP1.distanceTo(startPoint)).toBeLessThan(0.01);

    // Puerto 2 del codo en coordenadas locales está en (0, takeOff, 0)
    const localP2 = new THREE.Vector3(0, takeOff, 0).applyMatrix4(matrix);
    expect(localP2.distanceTo(placement.cutPoint2)).toBeLessThan(0.01);

    // Vértice en coordenadas locales (0, 0, 0) debe coincidir con vertex
    const localV = new THREE.Vector3(0, 0, 0).applyMatrix4(matrix);
    expect(localV.distanceTo(vertex)).toBeLessThan(0.01);

    // La cañería saliente debe extenderse en +Y
    const dirPipe2 = new THREE.Vector3().subVectors(pipe2.centerline[1], pipe2.centerline[0]).normalize();
    expect(dirPipe2.x).toBeCloseTo(0.0, 4);
    expect(dirPipe2.y).toBeCloseTo(1.0, 4);
    expect(dirPipe2.z).toBeCloseTo(0.0, 4);
  });

  it('Debe implementar recorte de caño previo (eje a eje) recortando take-off T al girar en 90°', () => {
    const graph = new PipingGraph('CS150', 2, 'SCH 40');
    const pipeSpec = reader.findPipe(2, 'CS150')!;
    const elbowSpec = reader.findElbow(2, 90, 'CS150')!;
    const takeOff = elbowSpec.takeOff!; // 76.2 mm

    // Simular flujo del usuario:
    // 1. Trazar 1000mm en +X (eje a eje)
    const initialGross = 1000;
    const pipe1 = graph.addPipe(new THREE.Vector3(0, 0, 0), new THREE.Vector3(initialGross, 0, 0), pipeSpec, initialGross);
    expect(pipe1.parameters.cutLength).toBeCloseTo(1000, 1);

    // 2. Girar hacia +Y con codo 90° y longitud 1000mm (eje a eje)
    const vertex = new THREE.Vector3(1000, 0, 0);
    const uIn = new THREE.Vector3(1, 0, 0);
    const uOut = new THREE.Vector3(0, 1, 0);
    const pStart = new THREE.Vector3(0, 0, 0);
    const pNext = vertex.clone().add(uOut.clone().multiplyScalar(1000));

    // Recortar pipe1 en take-off:
    const cutPoint1 = vertex.clone().sub(uIn.clone().multiplyScalar(takeOff));
    const netIncoming = pStart.distanceTo(cutPoint1); // 1000 - 76.2 = 923.8 mm
    expect(netIncoming).toBeCloseTo(923.8, 1);

    graph.removeComponent(pipe1.id);
    const cutPipe1 = graph.addPipe(pStart, cutPoint1, pipeSpec, netIncoming);
    expect(cutPipe1.parameters.cutLength).toBeCloseTo(923.8, 1);

    const placement = calculateElbowPlacement(pStart, vertex, pNext, takeOff, elbowSpec.radius);
    const elbow = graph.addElbow(placement, elbowSpec);
    graph.connectPorts(cutPipe1.ports[1].id, elbow.ports[0].id, 'BUTTWELD');

    const cutPipe2 = graph.addPipe(placement.cutPoint2, pNext, pipeSpec, placement.netLengthOutgoing);
    graph.connectPorts(elbow.ports[1].id, cutPipe2.ports[0].id, 'BUTTWELD');
    expect(cutPipe2.parameters.cutLength).toBeCloseTo(923.8, 1);

    // Comprobar que en el BOM ambos tramos figuran con longitud neta de 923.8 mm
    const bom = graph.calculateBillOfMaterials();
    const pipeBom = bom.find(b => b.type === 'PIPE');
    expect(pipeBom).toBeDefined();
    expect(pipeBom!.totalCutLengthMm).toBeCloseTo(1847.6, 1); // 923.8 * 2
  });

  it('Debe insertar accesorios de cañería (Flange, Valve, Tee, Reducer, Cap) preservando conectividad polar', () => {
    const graph = new PipingGraph('CS150', 2, 'SCH 40');
    const pipeSpec = reader.findPipe(2, 'CS150')!;
    const flgSpec = reader.findFlange(2, 'CS150')!;
    const vlvSpec = reader.findValve(2, 'CS150')!;
    const teeSpec = reader.findTee(2, 'CS150')!;
    const redSpec = reader.findReducer(3, 2, 'CS150')!;
    const capSpec = reader.findCap(2, 'CS150')!;

    // 1. Iniciar con un caño recto de 500 mm
    const pipe = graph.addPipe(new THREE.Vector3(0, 0, 0), new THREE.Vector3(500, 0, 0), pipeSpec);
    let openPort = pipe.ports[1];

    // 2. Insertar Brida (FLANGE)
    const flg = graph.addFlange(openPort, flgSpec);
    expect(flg.type).toBe('FLANGE');
    expect(flg.ports[0].connectedJointId).toBeDefined();
    expect(flg.ports[1].connectedJointId).toBeUndefined(); // Puerto libre
    openPort = flg.ports[1];

    // 3. Insertar Válvula (VALVE)
    const vlv = graph.addValve(openPort, vlvSpec);
    expect(vlv.type).toBe('VALVE');
    expect(vlv.ports[0].connectedJointId).toBeDefined();
    expect(vlv.ports[1].connectedJointId).toBeUndefined();
    openPort = vlv.ports[1];

    // 4. Insertar Te (TEE) con derivación hacia +Z
    const tee = graph.addTee(openPort, new THREE.Vector3(0, 0, 1), teeSpec);
    expect(tee.type).toBe('TEE');
    expect(tee.ports.length).toBe(3);
    expect(tee.ports[0].connectedJointId).toBeDefined();
    expect(tee.ports[1].connectedJointId).toBeUndefined(); // Puerto de salida corrida libre
    expect(tee.ports[2].connectedJointId).toBeUndefined(); // Boca de derivación libre
    openPort = tee.ports[1];

    // 5. Insertar Reducción Concéntrica (REDUCER)
    const red = graph.addReducer(openPort, redSpec);
    expect(red.type).toBe('REDUCER');
    expect(red.ports[0].connectedJointId).toBeDefined();
    expect(red.ports[1].connectedJointId).toBeUndefined();
    openPort = red.ports[1];

    // 6. Insertar Casquete / Tapa (CAP) para cerrar el extremo
    const cap = graph.addCap(openPort, capSpec);
    expect(cap.type).toBe('CAP');
    expect(cap.ports[0].connectedJointId).toBeDefined();

    // 7. Verificar que el Cómputo de Materiales (BOM) incluye todos los accesorios insertados
    const bom = graph.calculateBillOfMaterials();
    expect(bom.some(b => b.type === 'PIPE')).toBe(true);
    expect(bom.some(b => b.type === 'FLANGE')).toBe(true);
    expect(bom.some(b => b.type === 'VALVE')).toBe(true);
    expect(bom.some(b => b.type === 'TEE')).toBe(true);
    expect(bom.some(b => b.type === 'REDUCER')).toBe(true);
    expect(bom.some(b => b.type === 'CAP')).toBe(true);
  });

  it('Debe partir un caño existente en 2 niples al insertar una Te en línea y calcular extremos (Plano/Bisel)', () => {
    const graph = new PipingGraph('CS150', 2, 'SCH 40');
    const pipeSpec = reader.findPipe(2, 'CS150')!;
    const teeSpec = reader.findTee(2, 'CS150')!;

    const origPipe = graph.addPipe(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1000, 0, 0), pipeSpec);
    const splitRes = graph.splitPipeWithFitting(origPipe.id, teeSpec, pipeSpec, {
      offsetMm: 500,
      branchDir: new THREE.Vector3(0, 0, 1)
    });

    expect(splitRes).not.toBeNull();
    const C = teeSpec.runTakeOff || 63.5;
    expect(splitRes!.pipe1.parameters.cutLength).toBeCloseTo(500 - C, 1);
    expect(splitRes!.pipe2.parameters.cutLength).toBeCloseTo(500 - C, 1);

    const cutList = graph.calculatePipeCutList();
    expect(cutList.length).toBe(2);
    expect(cutList[0].nippleId).toBe('N-01');
    expect(cutList[0].endFinish1).toBe('Plano'); // Extremo inicial libre
    expect(cutList[0].endFinish2).toBe('Bisel'); // Conectado a la Te por soldadura a tope
    expect(cutList[1].nippleId).toBe('N-02');
    expect(cutList[1].endFinish1).toBe('Bisel'); // Conectado a la Te
    expect(cutList[1].endFinish2).toBe('Plano'); // Extremo final libre
  });

  it('Debe propagar cambios aguas abajo al modificar el largo de un caño o rotar un ramal de Te', () => {
    const graph = new PipingGraph('CS150', 2, 'SCH 40');
    const pipeSpec = reader.findPipe(2, 'CS150')!;
    const teeSpec = reader.findTee(2, 'CS150')!;

    const pipe1 = graph.addPipe(new THREE.Vector3(0, 0, 0), new THREE.Vector3(500, 0, 0), pipeSpec);
    const tee = graph.addTee(pipe1.ports[1], new THREE.Vector3(0, 0, 1), teeSpec);
    const branchStart = tee.ports[2].position.clone();
    const branchPipe = graph.addPipe(
      branchStart,
      branchStart.clone().add(new THREE.Vector3(0, 0, 400)),
      pipeSpec
    );
    graph.connectPorts(tee.ports[2].id, branchPipe.ports[0].id, 'BUTTWELD');

    // 1. Alargar pipe1 de 500 a 700 mm (+200 mm en +X) -> la Te y el caño de ramal deben moverse +200 mm en X
    const prevTeeX = tee.ports[0].position.x;
    graph.updatePipeLength(pipe1.id, 700);
    expect(tee.ports[0].position.x).toBeCloseTo(prevTeeX + 200, 2);
    expect(branchPipe.ports[1].position.x).toBeCloseTo(prevTeeX + (teeSpec.runTakeOff || 63.5) + 200, 2);

    // 2. Rotar la Te 90° alrededor del eje +X -> el ramal que iba en +Z ahora debe ir en -Y (o +Y)
    graph.rotateComponentAroundRun(tee.id, 90);
    expect(Math.abs(branchPipe.ports[1].direction.y)).toBeCloseTo(1.0, 2);
  });

  it('Debe exportar e importar un archivo PCF reconstruyendo niples y accesorios', () => {
    const graph = new PipingGraph('CS150', 2, 'SCH 40');
    const pipeSpec = reader.findPipe(2, 'CS150')!;
    const elbowSpec = reader.findElbow(2, 90, 'CS150')!;

    graph.routeTurnWithElbow(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1000, 0, 0),
      new THREE.Vector3(1000, 1000, 0),
      pipeSpec,
      elbowSpec
    );

    const pcfText = PcfExporter.exportToPcf(graph, { pipelineReference: '100-CS150-2"' });
    const imported = PcfImporter.importFromPcf(pcfText, reader, 'CS150');

    expect(imported.pipeCount).toBe(2);
    expect(imported.componentCount).toBe(3);
    expect(imported.lineReference).toBe('100-CS150-2"');
  });
});
