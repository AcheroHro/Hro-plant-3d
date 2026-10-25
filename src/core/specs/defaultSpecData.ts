/**
 * Catálogo industrial predeterminado de especificación CS150 (Carbon Steel ASME B31.3 / B16.9 / B16.5)
 * Datos dimensionales en milímetros (mm) de acuerdo con las tablas oficiales de piping.
 */

export interface SpecRecordSeed {
  pnpid: number;
  partType: string;
  specCode: string;
  shortDescription: string;
  catalogId: string;
  ports: {
    portIndex: number;
    nominalDiameter: number;
    matchingPipeOD: number;
    flangeOuterDiameter?: number;
    wallThickness: number;
    schedule: string;
    endType: string;
    pressureClass: string;
  }[];
  dimensions: {
    designLength?: number;
    length?: number;
    takeOff1?: number;
    takeOff2?: number;
    angle?: number;
    radius?: number;
    runTakeOff?: number;
    branchTakeOff?: number;
    faceToFace?: number;
    boltCircle?: number;
    boltHoles?: number;
    reducedNominalDiameter?: number;
    reducedOuterDiameter?: number;
  };
}

export const CS150_SPEC_DATA: SpecRecordSeed[] = [
  // ===================== CAÑERÍAS (PIPE ASTM A106 Gr. B / ASME B36.10M SCH 40) =====================
  {
    pnpid: 1001,
    partType: 'Pipe',
    specCode: 'CS150',
    shortDescription: 'PIPE ASTM A106 GR.B SCH 40 1/2"',
    catalogId: 'PIPE-CS-050',
    ports: [
      { portIndex: 1, nominalDiameter: 0.5, matchingPipeOD: 21.3, wallThickness: 2.77, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' },
      { portIndex: 2, nominalDiameter: 0.5, matchingPipeOD: 21.3, wallThickness: 2.77, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' }
    ],
    dimensions: { designLength: 6000 }
  },
  {
    pnpid: 1002,
    partType: 'Pipe',
    specCode: 'CS150',
    shortDescription: 'PIPE ASTM A106 GR.B SCH 40 3/4"',
    catalogId: 'PIPE-CS-075',
    ports: [
      { portIndex: 1, nominalDiameter: 0.75, matchingPipeOD: 26.7, wallThickness: 2.87, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' },
      { portIndex: 2, nominalDiameter: 0.75, matchingPipeOD: 26.7, wallThickness: 2.87, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' }
    ],
    dimensions: { designLength: 6000 }
  },
  {
    pnpid: 1003,
    partType: 'Pipe',
    specCode: 'CS150',
    shortDescription: 'PIPE ASTM A106 GR.B SCH 40 1"',
    catalogId: 'PIPE-CS-100',
    ports: [
      { portIndex: 1, nominalDiameter: 1, matchingPipeOD: 33.4, wallThickness: 3.38, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' },
      { portIndex: 2, nominalDiameter: 1, matchingPipeOD: 33.4, wallThickness: 3.38, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' }
    ],
    dimensions: { designLength: 6000 }
  },
  {
    pnpid: 1004,
    partType: 'Pipe',
    specCode: 'CS150',
    shortDescription: 'PIPE ASTM A106 GR.B SCH 40 1-1/2"',
    catalogId: 'PIPE-CS-150',
    ports: [
      { portIndex: 1, nominalDiameter: 1.5, matchingPipeOD: 48.3, wallThickness: 3.68, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' },
      { portIndex: 2, nominalDiameter: 1.5, matchingPipeOD: 48.3, wallThickness: 3.68, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' }
    ],
    dimensions: { designLength: 6000 }
  },
  {
    pnpid: 1005,
    partType: 'Pipe',
    specCode: 'CS150',
    shortDescription: 'PIPE ASTM A106 GR.B SCH 40 2"',
    catalogId: 'PIPE-CS-200',
    ports: [
      { portIndex: 1, nominalDiameter: 2, matchingPipeOD: 60.3, wallThickness: 3.91, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' },
      { portIndex: 2, nominalDiameter: 2, matchingPipeOD: 60.3, wallThickness: 3.91, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' }
    ],
    dimensions: { designLength: 6000 }
  },
  {
    pnpid: 1006,
    partType: 'Pipe',
    specCode: 'CS150',
    shortDescription: 'PIPE ASTM A106 GR.B SCH 40 3"',
    catalogId: 'PIPE-CS-300',
    ports: [
      { portIndex: 1, nominalDiameter: 3, matchingPipeOD: 88.9, wallThickness: 5.49, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' },
      { portIndex: 2, nominalDiameter: 3, matchingPipeOD: 88.9, wallThickness: 5.49, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' }
    ],
    dimensions: { designLength: 6000 }
  },
  {
    pnpid: 1007,
    partType: 'Pipe',
    specCode: 'CS150',
    shortDescription: 'PIPE ASTM A106 GR.B SCH 40 4"',
    catalogId: 'PIPE-CS-400',
    ports: [
      { portIndex: 1, nominalDiameter: 4, matchingPipeOD: 114.3, wallThickness: 6.02, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' },
      { portIndex: 2, nominalDiameter: 4, matchingPipeOD: 114.3, wallThickness: 6.02, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' }
    ],
    dimensions: { designLength: 6000 }
  },
  {
    pnpid: 1008,
    partType: 'Pipe',
    specCode: 'CS150',
    shortDescription: 'PIPE ASTM A106 GR.B SCH 40 6"',
    catalogId: 'PIPE-CS-600',
    ports: [
      { portIndex: 1, nominalDiameter: 6, matchingPipeOD: 168.3, wallThickness: 7.11, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' },
      { portIndex: 2, nominalDiameter: 6, matchingPipeOD: 168.3, wallThickness: 7.11, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' }
    ],
    dimensions: { designLength: 6000 }
  },

  // ===================== CODOS 90° LR (ELBOW 90° ASME B16.9 SCH 40 BW) =====================
  {
    pnpid: 2001,
    partType: 'Elbow',
    specCode: 'CS150',
    shortDescription: 'ELBOW 90 LR ASTM A234 WPB SCH 40 1/2"',
    catalogId: 'ELB90-CS-050',
    ports: [
      { portIndex: 1, nominalDiameter: 0.5, matchingPipeOD: 21.3, wallThickness: 2.77, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' },
      { portIndex: 2, nominalDiameter: 0.5, matchingPipeOD: 21.3, wallThickness: 2.77, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' }
    ],
    dimensions: { angle: 90, radius: 38.1, takeOff1: 38.1, takeOff2: 38.1 }
  },
  {
    pnpid: 2002,
    partType: 'Elbow',
    specCode: 'CS150',
    shortDescription: 'ELBOW 90 LR ASTM A234 WPB SCH 40 3/4"',
    catalogId: 'ELB90-CS-075',
    ports: [
      { portIndex: 1, nominalDiameter: 0.75, matchingPipeOD: 26.7, wallThickness: 2.87, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' },
      { portIndex: 2, nominalDiameter: 0.75, matchingPipeOD: 26.7, wallThickness: 2.87, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' }
    ],
    dimensions: { angle: 90, radius: 38.1, takeOff1: 38.1, takeOff2: 38.1 }
  },
  {
    pnpid: 2003,
    partType: 'Elbow',
    specCode: 'CS150',
    shortDescription: 'ELBOW 90 LR ASTM A234 WPB SCH 40 1"',
    catalogId: 'ELB90-CS-100',
    ports: [
      { portIndex: 1, nominalDiameter: 1, matchingPipeOD: 33.4, wallThickness: 3.38, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' },
      { portIndex: 2, nominalDiameter: 1, matchingPipeOD: 33.4, wallThickness: 3.38, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' }
    ],
    dimensions: { angle: 90, radius: 38.1, takeOff1: 38.1, takeOff2: 38.1 }
  },
  {
    pnpid: 2004,
    partType: 'Elbow',
    specCode: 'CS150',
    shortDescription: 'ELBOW 90 LR ASTM A234 WPB SCH 40 1-1/2"',
    catalogId: 'ELB90-CS-150',
    ports: [
      { portIndex: 1, nominalDiameter: 1.5, matchingPipeOD: 48.3, wallThickness: 3.68, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' },
      { portIndex: 2, nominalDiameter: 1.5, matchingPipeOD: 48.3, wallThickness: 3.68, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' }
    ],
    dimensions: { angle: 90, radius: 57.2, takeOff1: 57.2, takeOff2: 57.2 }
  },
  {
    pnpid: 2005,
    partType: 'Elbow',
    specCode: 'CS150',
    shortDescription: 'ELBOW 90 LR ASTM A234 WPB SCH 40 2"',
    catalogId: 'ELB90-CS-200',
    ports: [
      { portIndex: 1, nominalDiameter: 2, matchingPipeOD: 60.3, wallThickness: 3.91, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' },
      { portIndex: 2, nominalDiameter: 2, matchingPipeOD: 60.3, wallThickness: 3.91, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' }
    ],
    dimensions: { angle: 90, radius: 76.2, takeOff1: 76.2, takeOff2: 76.2 }
  },
  {
    pnpid: 2006,
    partType: 'Elbow',
    specCode: 'CS150',
    shortDescription: 'ELBOW 90 LR ASTM A234 WPB SCH 40 3"',
    catalogId: 'ELB90-CS-300',
    ports: [
      { portIndex: 1, nominalDiameter: 3, matchingPipeOD: 88.9, wallThickness: 5.49, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' },
      { portIndex: 2, nominalDiameter: 3, matchingPipeOD: 88.9, wallThickness: 5.49, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' }
    ],
    dimensions: { angle: 90, radius: 114.3, takeOff1: 114.3, takeOff2: 114.3 }
  },
  {
    pnpid: 2007,
    partType: 'Elbow',
    specCode: 'CS150',
    shortDescription: 'ELBOW 90 LR ASTM A234 WPB SCH 40 4"',
    catalogId: 'ELB90-CS-400',
    ports: [
      { portIndex: 1, nominalDiameter: 4, matchingPipeOD: 114.3, wallThickness: 6.02, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' },
      { portIndex: 2, nominalDiameter: 4, matchingPipeOD: 114.3, wallThickness: 6.02, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' }
    ],
    dimensions: { angle: 90, radius: 152.4, takeOff1: 152.4, takeOff2: 152.4 }
  },
  {
    pnpid: 2008,
    partType: 'Elbow',
    specCode: 'CS150',
    shortDescription: 'ELBOW 90 LR ASTM A234 WPB SCH 40 6"',
    catalogId: 'ELB90-CS-600',
    ports: [
      { portIndex: 1, nominalDiameter: 6, matchingPipeOD: 168.3, wallThickness: 7.11, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' },
      { portIndex: 2, nominalDiameter: 6, matchingPipeOD: 168.3, wallThickness: 7.11, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' }
    ],
    dimensions: { angle: 90, radius: 228.6, takeOff1: 228.6, takeOff2: 228.6 }
  },

  // ===================== CODOS 45° LR (ELBOW 45° ASME B16.9 SCH 40 BW) =====================
  {
    pnpid: 2505,
    partType: 'Elbow',
    specCode: 'CS150',
    shortDescription: 'ELBOW 45 LR ASTM A234 WPB SCH 40 2"',
    catalogId: 'ELB45-CS-200',
    ports: [
      { portIndex: 1, nominalDiameter: 2, matchingPipeOD: 60.3, wallThickness: 3.91, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' },
      { portIndex: 2, nominalDiameter: 2, matchingPipeOD: 60.3, wallThickness: 3.91, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' }
    ],
    dimensions: { angle: 45, radius: 76.2, takeOff1: 35.0, takeOff2: 35.0 }
  },
  {
    pnpid: 2506,
    partType: 'Elbow',
    specCode: 'CS150',
    shortDescription: 'ELBOW 45 LR ASTM A234 WPB SCH 40 3"',
    catalogId: 'ELB45-CS-300',
    ports: [
      { portIndex: 1, nominalDiameter: 3, matchingPipeOD: 88.9, wallThickness: 5.49, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' },
      { portIndex: 2, nominalDiameter: 3, matchingPipeOD: 88.9, wallThickness: 5.49, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' }
    ],
    dimensions: { angle: 45, radius: 114.3, takeOff1: 50.8, takeOff2: 50.8 }
  },
  {
    pnpid: 2507,
    partType: 'Elbow',
    specCode: 'CS150',
    shortDescription: 'ELBOW 45 LR ASTM A234 WPB SCH 40 4"',
    catalogId: 'ELB45-CS-400',
    ports: [
      { portIndex: 1, nominalDiameter: 4, matchingPipeOD: 114.3, wallThickness: 6.02, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' },
      { portIndex: 2, nominalDiameter: 4, matchingPipeOD: 114.3, wallThickness: 6.02, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' }
    ],
    dimensions: { angle: 45, radius: 152.4, takeOff1: 63.5, takeOff2: 63.5 }
  },

  // ===================== TES IGUALES (TEE EQUAL ASME B16.9 SCH 40 BW) =====================
  {
    pnpid: 3005,
    partType: 'Tee',
    specCode: 'CS150',
    shortDescription: 'TEE STRAIGHT ASTM A234 WPB SCH 40 2"',
    catalogId: 'TEE-CS-200',
    ports: [
      { portIndex: 1, nominalDiameter: 2, matchingPipeOD: 60.3, wallThickness: 3.91, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' },
      { portIndex: 2, nominalDiameter: 2, matchingPipeOD: 60.3, wallThickness: 3.91, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' },
      { portIndex: 3, nominalDiameter: 2, matchingPipeOD: 60.3, wallThickness: 3.91, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' }
    ],
    dimensions: { runTakeOff: 63.5, branchTakeOff: 63.5 }
  },
  {
    pnpid: 3006,
    partType: 'Tee',
    specCode: 'CS150',
    shortDescription: 'TEE STRAIGHT ASTM A234 WPB SCH 40 3"',
    catalogId: 'TEE-CS-300',
    ports: [
      { portIndex: 1, nominalDiameter: 3, matchingPipeOD: 88.9, wallThickness: 5.49, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' },
      { portIndex: 2, nominalDiameter: 3, matchingPipeOD: 88.9, wallThickness: 5.49, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' },
      { portIndex: 3, nominalDiameter: 3, matchingPipeOD: 88.9, wallThickness: 5.49, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' }
    ],
    dimensions: { runTakeOff: 85.7, branchTakeOff: 85.7 }
  },
  {
    pnpid: 3007,
    partType: 'Tee',
    specCode: 'CS150',
    shortDescription: 'TEE STRAIGHT ASTM A234 WPB SCH 40 4"',
    catalogId: 'TEE-CS-400',
    ports: [
      { portIndex: 1, nominalDiameter: 4, matchingPipeOD: 114.3, wallThickness: 6.02, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' },
      { portIndex: 2, nominalDiameter: 4, matchingPipeOD: 114.3, wallThickness: 6.02, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' },
      { portIndex: 3, nominalDiameter: 4, matchingPipeOD: 114.3, wallThickness: 6.02, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' }
    ],
    dimensions: { runTakeOff: 104.8, branchTakeOff: 104.8 }
  },

  // ===================== BRIDAS CON CUELLO (FLANGE WELDING NECK ASME B16.5 CL 150 RF) =====================
  {
    pnpid: 4005,
    partType: 'Flange',
    specCode: 'CS150',
    shortDescription: 'FLANGE WN RF ASTM A105 CL 150 2"',
    catalogId: 'FLG-WN-150-200',
    ports: [
      { portIndex: 1, nominalDiameter: 2, matchingPipeOD: 60.3, flangeOuterDiameter: 152.4, wallThickness: 3.91, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' },
      { portIndex: 2, nominalDiameter: 2, matchingPipeOD: 60.3, flangeOuterDiameter: 152.4, wallThickness: 3.91, schedule: 'SCH 40', endType: 'FLANG', pressureClass: '150' }
    ],
    dimensions: { faceToFace: 63.5, boltCircle: 120.7, boltHoles: 4 }
  },
  {
    pnpid: 4006,
    partType: 'Flange',
    specCode: 'CS150',
    shortDescription: 'FLANGE WN RF ASTM A105 CL 150 3"',
    catalogId: 'FLG-WN-150-300',
    ports: [
      { portIndex: 1, nominalDiameter: 3, matchingPipeOD: 88.9, flangeOuterDiameter: 190.5, wallThickness: 5.49, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' },
      { portIndex: 2, nominalDiameter: 3, matchingPipeOD: 88.9, flangeOuterDiameter: 190.5, wallThickness: 5.49, schedule: 'SCH 40', endType: 'FLANG', pressureClass: '150' }
    ],
    dimensions: { faceToFace: 69.9, boltCircle: 152.4, boltHoles: 4 }
  },
  {
    pnpid: 4007,
    partType: 'Flange',
    specCode: 'CS150',
    shortDescription: 'FLANGE WN RF ASTM A105 CL 150 4"',
    catalogId: 'FLG-WN-150-400',
    ports: [
      { portIndex: 1, nominalDiameter: 4, matchingPipeOD: 114.3, flangeOuterDiameter: 228.6, wallThickness: 6.02, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' },
      { portIndex: 2, nominalDiameter: 4, matchingPipeOD: 114.3, flangeOuterDiameter: 228.6, wallThickness: 6.02, schedule: 'SCH 40', endType: 'FLANG', pressureClass: '150' }
    ],
    dimensions: { faceToFace: 76.2, boltCircle: 190.5, boltHoles: 8 }
  },

  // ===================== REDUCCIONES CONCÉNTRICAS (REDUCER CONCENTRIC ASME B16.9 SCH 40 BW) =====================
  {
    pnpid: 5001,
    partType: 'Reducer',
    specCode: 'CS150',
    shortDescription: 'REDUCER CONC ASTM A234 WPB SCH 40 3"x2"',
    catalogId: 'RED-CON-300-200',
    ports: [
      { portIndex: 1, nominalDiameter: 3, matchingPipeOD: 88.9, wallThickness: 5.49, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' },
      { portIndex: 2, nominalDiameter: 2, matchingPipeOD: 60.3, wallThickness: 3.91, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' }
    ],
    dimensions: { faceToFace: 88.9, reducedNominalDiameter: 2, reducedOuterDiameter: 60.3 }
  },
  {
    pnpid: 5002,
    partType: 'Reducer',
    specCode: 'CS150',
    shortDescription: 'REDUCER CONC ASTM A234 WPB SCH 40 4"x3"',
    catalogId: 'RED-CON-400-300',
    ports: [
      { portIndex: 1, nominalDiameter: 4, matchingPipeOD: 114.3, wallThickness: 6.02, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' },
      { portIndex: 2, nominalDiameter: 3, matchingPipeOD: 88.9, wallThickness: 5.49, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' }
    ],
    dimensions: { faceToFace: 101.6, reducedNominalDiameter: 3, reducedOuterDiameter: 88.9 }
  },
  {
    pnpid: 5003,
    partType: 'Reducer',
    specCode: 'CS150',
    shortDescription: 'REDUCER CONC ASTM A234 WPB SCH 40 4"x2"',
    catalogId: 'RED-CON-400-200',
    ports: [
      { portIndex: 1, nominalDiameter: 4, matchingPipeOD: 114.3, wallThickness: 6.02, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' },
      { portIndex: 2, nominalDiameter: 2, matchingPipeOD: 60.3, wallThickness: 3.91, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' }
    ],
    dimensions: { faceToFace: 101.6, reducedNominalDiameter: 2, reducedOuterDiameter: 60.3 }
  },

  // ===================== VÁLVULAS (VALVE ASME B16.10 CL 150) =====================
  {
    pnpid: 6001,
    partType: 'Valve',
    specCode: 'CS150',
    shortDescription: 'VALVE BALL FLANGED ASME B16.10 CL 150 1"',
    catalogId: 'VLV-BALL-100',
    ports: [
      { portIndex: 1, nominalDiameter: 1, matchingPipeOD: 33.4, flangeOuterDiameter: 108.0, wallThickness: 3.38, schedule: '150#', endType: 'FLANG', pressureClass: '150' },
      { portIndex: 2, nominalDiameter: 1, matchingPipeOD: 33.4, flangeOuterDiameter: 108.0, wallThickness: 3.38, schedule: '150#', endType: 'FLANG', pressureClass: '150' }
    ],
    dimensions: { faceToFace: 127.0, boltCircle: 79.2, boltHoles: 4 }
  },
  {
    pnpid: 6002,
    partType: 'Valve',
    specCode: 'CS150',
    shortDescription: 'VALVE BALL FLANGED ASME B16.10 CL 150 2"',
    catalogId: 'VLV-BALL-200',
    ports: [
      { portIndex: 1, nominalDiameter: 2, matchingPipeOD: 60.3, flangeOuterDiameter: 152.4, wallThickness: 3.91, schedule: '150#', endType: 'FLANG', pressureClass: '150' },
      { portIndex: 2, nominalDiameter: 2, matchingPipeOD: 60.3, flangeOuterDiameter: 152.4, wallThickness: 3.91, schedule: '150#', endType: 'FLANG', pressureClass: '150' }
    ],
    dimensions: { faceToFace: 178.0, boltCircle: 120.7, boltHoles: 4 }
  },
  {
    pnpid: 6003,
    partType: 'Valve',
    specCode: 'CS150',
    shortDescription: 'VALVE BALL FLANGED ASME B16.10 CL 150 3"',
    catalogId: 'VLV-BALL-300',
    ports: [
      { portIndex: 1, nominalDiameter: 3, matchingPipeOD: 88.9, flangeOuterDiameter: 190.5, wallThickness: 5.49, schedule: '150#', endType: 'FLANG', pressureClass: '150' },
      { portIndex: 2, nominalDiameter: 3, matchingPipeOD: 88.9, flangeOuterDiameter: 190.5, wallThickness: 5.49, schedule: '150#', endType: 'FLANG', pressureClass: '150' }
    ],
    dimensions: { faceToFace: 203.2, boltCircle: 152.4, boltHoles: 4 }
  },
  {
    pnpid: 6004,
    partType: 'Valve',
    specCode: 'CS150',
    shortDescription: 'VALVE BALL FLANGED ASME B16.10 CL 150 4"',
    catalogId: 'VLV-BALL-400',
    ports: [
      { portIndex: 1, nominalDiameter: 4, matchingPipeOD: 114.3, flangeOuterDiameter: 228.6, wallThickness: 6.02, schedule: '150#', endType: 'FLANG', pressureClass: '150' },
      { portIndex: 2, nominalDiameter: 4, matchingPipeOD: 114.3, flangeOuterDiameter: 228.6, wallThickness: 6.02, schedule: '150#', endType: 'FLANG', pressureClass: '150' }
    ],
    dimensions: { faceToFace: 228.6, boltCircle: 190.5, boltHoles: 8 }
  },

  // ===================== TAPAS / CASQUETES (CAP ASME B16.9 SCH 40 BW) =====================
  {
    pnpid: 7001,
    partType: 'Cap',
    specCode: 'CS150',
    shortDescription: 'CAP ASTM A234 WPB SCH 40 2"',
    catalogId: 'CAP-CS-200',
    ports: [
      { portIndex: 1, nominalDiameter: 2, matchingPipeOD: 60.3, wallThickness: 3.91, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' }
    ],
    dimensions: { faceToFace: 38.1 }
  },
  {
    pnpid: 7002,
    partType: 'Cap',
    specCode: 'CS150',
    shortDescription: 'CAP ASTM A234 WPB SCH 40 3"',
    catalogId: 'CAP-CS-300',
    ports: [
      { portIndex: 1, nominalDiameter: 3, matchingPipeOD: 88.9, wallThickness: 5.49, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' }
    ],
    dimensions: { faceToFace: 50.8 }
  },
  {
    pnpid: 7003,
    partType: 'Cap',
    specCode: 'CS150',
    shortDescription: 'CAP ASTM A234 WPB SCH 40 4"',
    catalogId: 'CAP-CS-400',
    ports: [
      { portIndex: 1, nominalDiameter: 4, matchingPipeOD: 114.3, wallThickness: 6.02, schedule: 'SCH 40', endType: 'BW', pressureClass: '150' }
    ],
    dimensions: { faceToFace: 63.5 }
  }
];
