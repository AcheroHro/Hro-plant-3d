import fs from 'fs';
import initSqlJs from 'sql.js';

async function listElbows2() {
  const SQL = await initSqlJs();
  const filebuffer = fs.readFileSync('RCI1.pspc');
  const db = new SQL.Database(filebuffer);

  const res = db.exec(`
    SELECT e.PnPID, e.ShortDescription, elb.PathAngle, elb.CurveRadius, e.ContentGeometryParamDefinition
    FROM EngineeringItems e
    JOIN Elbow elb ON e.PnPID = elb.PnPID
    WHERE ABS(e.NominalDiameter - 2) < 0.01;
  `);
  console.log('Todos los codos de 2" en RCI1:', res[0]?.values);
}

listElbows2().catch(console.error);
