import fs from 'fs';
import initSqlJs from 'sql.js';

async function inspect() {
  const SQL = await initSqlJs();
  const filebuffer = fs.readFileSync('RCI1.pspc');
  const db = new SQL.Database(filebuffer);
  const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table';");
  console.log('TABLAS:', JSON.stringify(tables[0]?.values.flat() || []));
  
  const allTables = tables[0]?.values.flat() || [];
  for (const t of allTables) {
    try {
      const count = db.exec(`SELECT count(*) FROM "${t}";`);
      console.log(`Tabla ${t}: ${count[0]?.values[0][0]} filas`);
    } catch(e) {
      console.log(`Tabla ${t}: error`);
    }
  }

  // Veamos columnas de EngineeringItems y PipePortProperties si existen
  for (const t of ['EngineeringItems', 'PipePortProperties', 'PartSizeProperties']) {
    try {
      const info = db.exec(`PRAGMA table_info("${t}");`);
      console.log(`COLUMNAS ${t}:`, JSON.stringify(info[0]?.values.map(v => v[1])));
      const sample = db.exec(`SELECT * FROM "${t}" LIMIT 2;`);
      console.log(`SAMPLE ${t}:`, JSON.stringify(sample[0]?.values));
    } catch(e) {}
  }
}

inspect().catch(console.error);
