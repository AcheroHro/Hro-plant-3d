import fs from 'fs';
import initSqlJs from 'sql.js';

async function inspectTables() {
  const SQL = await initSqlJs();
  const filebuffer = fs.readFileSync('RCI1.pspc');
  const db = new SQL.Database(filebuffer);

  for (const t of ['Pipe', 'Elbow', 'Tee', 'Flange', 'Reducer', 'Port', 'PartPort']) {
    try {
      const info = db.exec(`PRAGMA table_info("${t}");`);
      console.log(`\n=== TABLA ${t} ===`);
      console.log('Columnas:', info[0]?.values.map(v => v[1]).join(', '));
      const sample = db.exec(`SELECT * FROM "${t}" LIMIT 2;`);
      console.log('Sample row:', JSON.stringify(sample[0]?.values[0]));
    } catch(e) {
      console.log(`Error en ${t}:`, e.message);
    }
  }
}

inspectTables().catch(console.error);
