import fs from 'fs';
import initSqlJs from 'sql.js';

async function testNative() {
  const SQL = await initSqlJs();
  const filebuffer = fs.readFileSync('RCI1.pspc');
  const db = new SQL.Database(filebuffer);

  // 1. Detectar si es nativo
  const hasPartPort = db.exec("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='PartPort';")[0]?.values[0][0] > 0;
  console.log('¿Es nativo Plant 3D?:', hasPartPort);

  // 2. Query para PIPE de 2"
  const pipe = db.exec(`
    SELECT e.PnPID, e.ShortDescription, e.NominalDiameter, e.NominalUnit, e.MatchingPipeOd, 
           e.Schedule, e.WallThickness, e.ContentGeometryParamDefinition
    FROM EngineeringItems e
    JOIN Pipe p ON e.PnPID = p.PnPID
    WHERE ABS(e.NominalDiameter - 2) < 0.01
    LIMIT 1;
  `);
  console.log('Pipe 2":', pipe[0]?.values[0]);

  // 3. Query para Elbow 90° de 2"
  const elb90 = db.exec(`
    SELECT e.PnPID, e.ShortDescription, e.NominalDiameter, e.NominalUnit, e.MatchingPipeOd, 
           elb.PathAngle, elb.CurveRadius, e.ContentGeometryParamDefinition
    FROM EngineeringItems e
    JOIN Elbow elb ON e.PnPID = elb.PnPID
    WHERE ABS(e.NominalDiameter - 2) < 0.01 AND ABS(elb.PathAngle - 90) < 1
    LIMIT 1;
  `);
  console.log('Elbow 90° 2":', elb90[0]?.values[0]);

  // 4. Query para Elbow 45° de 2"
  const elb45 = db.exec(`
    SELECT e.PnPID, e.ShortDescription, e.NominalDiameter, e.NominalUnit, e.MatchingPipeOd, 
           elb.PathAngle, elb.CurveRadius, e.ContentGeometryParamDefinition
    FROM EngineeringItems e
    JOIN Elbow elb ON e.PnPID = elb.PnPID
    WHERE ABS(e.NominalDiameter - 2) < 0.01 AND ABS(elb.PathAngle - 45) < 1
    LIMIT 1;
  `);
  console.log('Elbow 45° 2":', elb45[0]?.values[0]);
}

testNative().catch(console.error);
