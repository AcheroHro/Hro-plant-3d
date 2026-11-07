import fs from 'fs';
import path from 'path';
import { SpecDatabaseReader } from '../core/specs/SpecDatabaseReader';

/** Rutas de los archivos reales usados como datos de prueba (fase 0) */
export const ROOT = path.resolve(__dirname, '..', '..');
export const FIXTURES = path.join(ROOT, 'test-fixtures');

export function fixturePath(...parts: string[]): string {
  return path.join(FIXTURES, ...parts);
}

export function readFixture(...parts: string[]): Buffer {
  return fs.readFileSync(fixturePath(...parts));
}

export function readFixtureText(...parts: string[]): string {
  return fs.readFileSync(fixturePath(...parts), 'utf8');
}

export function listFixtures(dir: string, ext: string): string[] {
  return fs
    .readdirSync(fixturePath(dir))
    .filter((f) => f.toLowerCase().endsWith(ext))
    .sort();
}

const cache = new Map<string, Promise<SpecDatabaseReader>>();

/** Carga una spec real: .pspc de public/ o de test-fixtures/specs, con su .pspx si existe */
export function loadSpec(name: string): Promise<SpecDatabaseReader> {
  let p = cache.get(name);
  if (!p) {
    const candidates = [path.join(FIXTURES, 'specs', `${name}.pspc`), path.join(ROOT, 'public', `${name}.pspc`)];
    const pspc = candidates.find((c) => fs.existsSync(c));
    if (!pspc) throw new Error(`No está la spec ${name}`);
    const pspxPath = path.join(FIXTURES, 'specs', `${name}.pspx`);
    const pspx = fs.existsSync(pspxPath) ? fs.readFileSync(pspxPath) : undefined;
    p = SpecDatabaseReader.fromBuffer(fs.readFileSync(pspc), name, pspx);
    cache.set(name, p);
  }
  return p;
}
