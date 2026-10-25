import fs from 'fs';
import initSqlJs from 'sql.js';

async function inspectFull() {
  const SQL = await initSqlJs();
  const filebuffer = fs.readFileSync('RCI1.pspc');
  const db = new SQL.Database(filebuffer);

  console.log('--- 2. ELBOWS 90 Y 45 ---');
  const elbows = db.exec(`
    SELECT e.PnPID, e.ShortDescription, e.NominalDiameter, e.NominalUnit, e.MatchingPipeOd, 
           elb.PathAngle, elb.CurveRadius, e.ContentGeometryParamDefinition
    FROM EngineeringItems e
    JOIN Elbow elb ON e.PnPID = elb.PnPID
    ORDER BY elb.PathAngle, e.NominalDiameter
    LIMIT 10;
  `);
  console.log(JSON.stringify(elbows[0]?.values, null, 2));

  console.log('--- 3. REDUCERS ---');
  const red = db.exec(`
    SELECT e.PnPID, e.ShortDescription, e.NominalDiameter, e.MatchingPipeOd, 
           r.Length, e.ContentGeometryParamDefinition
    FROM EngineeringItems e
    JOIN Reducer r ON e.PnPID = r.PnPID
    LIMIT 4;
  `);
  console.log(JSON.stringify(red[0]?.values, null, 2));

  console.log('--- 4. REDUCER PORTS (D1 vs D2) ---');
  const redPorts = db.exec(`
    SELECT pp.Part, p.PortName, p.NominalDiameter, p.MatchingPipeOd, p.EndType
    FROM PartPort pp
    JOIN Port p ON pp.Port = p.PnPID
    WHERE pp.Part IN (SELECT PnPID FROM Reducer LIMIT 2);
  `);
  console.log(JSON.stringify(redPorts[0]?.values, null, 2));

  console.log('--- 5. TEES PORTS ---');
  const teePorts = db.exec(`
    SELECT pp.Part, p.PortName, p.NominalDiameter, p.MatchingPipeOd, p.EndType
    FROM PartPort pp
    JOIN Port p ON pp.Port = p.PnPID
    WHERE pp.Part IN (SELECT PnPID FROM Tee LIMIT 2);
  `);
  console.log(JSON.stringify(teePorts[0]?.values, null, 2));
}

inspectFull().catch(console.error);
