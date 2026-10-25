import fs from 'fs';
import initSqlJs from 'sql.js';

async function inspectContentParams() {
  const SQL = await initSqlJs();
  const filebuffer = fs.readFileSync('RCI1.pspc');
  const db = new SQL.Database(filebuffer);

  console.log('\n--- MUESTRA DE ELBOWS EN RCI1.pspc ---');
  const elbows = db.exec(`
    SELECT e.PnPID, e.ShortDescription, e.NominalDiameter, e.NominalUnit, e.MatchingPipeOd, 
           e.Schedule, e.WallThickness, e.ContentGeometryParamDefinition, elb.PathAngle, elb.CurveRadius
    FROM EngineeringItems e
    JOIN Elbow elb ON e.PnPID = elb.PnPID
    LIMIT 5;
  `);
  console.log(JSON.stringify(elbows[0]?.values, null, 2));

  console.log('\n--- MUESTRA DE PIPES EN RCI1.pspc ---');
  const pipes = db.exec(`
    SELECT e.PnPID, e.ShortDescription, e.NominalDiameter, e.NominalUnit, e.MatchingPipeOd, 
           e.Schedule, e.WallThickness, e.ContentGeometryParamDefinition
    FROM EngineeringItems e
    JOIN Pipe p ON e.PnPID = p.PnPID
    LIMIT 3;
  `);
  console.log(JSON.stringify(pipes[0]?.values, null, 2));

  console.log('\n--- MUESTRA DE TEES EN RCI1.pspc ---');
  const tees = db.exec(`
    SELECT e.PnPID, e.ShortDescription, e.NominalDiameter, e.NominalUnit, e.MatchingPipeOd, 
           e.Schedule, e.WallThickness, e.ContentGeometryParamDefinition
    FROM EngineeringItems e
    JOIN Tee t ON e.PnPID = t.PnPID
    LIMIT 3;
  `);
  console.log(JSON.stringify(tees[0]?.values, null, 2));
}

inspectContentParams().catch(console.error);
