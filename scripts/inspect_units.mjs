import fs from 'fs';
import initSqlJs from 'sql.js';

async function inspectUnits() {
  const SQL = await initSqlJs();
  const filebuffer = fs.readFileSync('RCI1.pspc');
  const db = new SQL.Database(filebuffer);

  const meta = db.exec("SELECT * FROM RepositoryDescriptor;");
  console.log('RepositoryDescriptor:', JSON.stringify(meta[0]));

  const pipeUnits = db.exec("SELECT DISTINCT NominalUnit, LengthUnit FROM EngineeringItems WHERE NominalUnit IS NOT NULL;");
  console.log('Unidades en EngineeringItems:', JSON.stringify(pipeUnits[0]));
}

inspectUnits().catch(console.error);
