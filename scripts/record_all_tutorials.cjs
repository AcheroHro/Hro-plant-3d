const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const outDir = path.resolve('videos');
fs.mkdirSync(outDir, { recursive: true });

async function injectOverlay(page, title, subtitle) {
  await page.evaluate(({ title, subtitle }) => {
    // Remove existing if any
    const old = document.getElementById('tutorial-overlay');
    if (old) old.remove();

    const box = document.createElement('div');
    box.id = 'tutorial-overlay';
    box.style.position = 'fixed';
    box.style.inset = '0';
    box.style.pointerEvents = 'none';
    box.style.zIndex = '999999';
    box.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

    box.innerHTML = `
      <!-- Top Title Banner -->
      <div style="position: absolute; top: 14px; left: 50%; transform: translateX(-50%); background: rgba(15, 23, 42, 0.92); border: 2px solid #0284c7; border-radius: 10px; padding: 10px 24px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); text-align: center; backdrop-filter: blur(8px);">
        <div style="color: #38bdf8; font-size: 13px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase;">
          ⚙️ ACHERO PLANT 3D &middot; VIDEO TUTORIAL
        </div>
        <div style="color: #ffffff; font-size: 17px; font-weight: 800; margin-top: 2px;">
          ${title}
        </div>
      </div>

      <!-- Bottom Subtitle Bar -->
      <div id="sub-bar" style="position: absolute; bottom: 22px; left: 50%; transform: translateX(-50%); background: rgba(15, 23, 42, 0.95); border-left: 4px solid #38bdf8; border-radius: 8px; padding: 12px 28px; max-width: 880px; width: 90%; box-shadow: 0 10px 30px rgba(0,0,0,0.6); text-align: center; backdrop-filter: blur(8px);">
        <div id="sub-text" style="color: #f8fafc; font-size: 15px; font-weight: 600; line-height: 1.4;">
          ${subtitle}
        </div>
      </div>

      <!-- Virtual Cursor -->
      <div id="v-cursor" style="position: absolute; top: 300px; left: 600px; width: 22px; height: 22px; pointer-events: none; transition: all 0.5s ease-out; z-index: 1000000;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <polygon points="2,2 9,21 13,13 21,9" fill="#0284c7" stroke="#ffffff" stroke-width="2"/>
        </svg>
        <div id="v-cursor-pulse" style="position: absolute; top: -6px; left: -6px; width: 34px; height: 34px; border: 2px solid #38bdf8; border-radius: 50%; opacity: 0; transition: all 0.3s;"></div>
      </div>
    `;

    document.body.appendChild(box);
  }, { title, subtitle });
}

async function updateSubtitle(page, text) {
  await page.evaluate(t => {
    const el = document.getElementById('sub-text');
    if (el) el.innerText = t;
  }, text);
}

async function moveCursor(page, x, y, click = false) {
  await page.evaluate(({ x, y, click }) => {
    const c = document.getElementById('v-cursor');
    const p = document.getElementById('v-cursor-pulse');
    if (c) {
      c.style.left = x + 'px';
      c.style.top = y + 'px';
    }
    if (click && p) {
      p.style.opacity = '1';
      p.style.transform = 'scale(1.5)';
      setTimeout(() => {
        p.style.opacity = '0';
        p.style.transform = 'scale(1)';
      }, 350);
    }
  }, { x, y, click });
  await page.waitForTimeout(400);
}

// ---------------- VIDEO 1 ----------------
async function recordVideo1(browser) {
  console.log('--- Grabando Video 1: Trazado 3D y Codos Automáticos ---');
  const tempDir = path.resolve('scratch/v1_temp');
  fs.mkdirSync(tempDir, { recursive: true });

  const context = await browser.newContext({
    recordVideo: { dir: tempDir, size: { width: 1280, height: 720 } },
    viewport: { width: 1280, height: 720 }
  });
  const page = await context.newPage();
  await page.goto('https://achero-plant-3d.vercel.app');
  await page.waitForLoadState('networkidle');

  await injectOverlay(page, 'Módulo 1: Selección de Spec y Ruteo 3D de Cañerías', 'Bienvenido a Achero Plant 3D. Seleccionamos el catálogo oficial CS150 para acero al carbono.');
  await page.waitForTimeout(2000);

  // 1. Point to Spec selector
  await moveCursor(page, 280, 20, true);
  await page.evaluate(() => {
    const sel = document.querySelectorAll('select')[0];
    if (sel) { sel.value = 'CS150'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await updateSubtitle(page, 'Elegimos la especificación CS150 (Rating 150#) con datos de AutoCAD Plant 3D.');
  await page.waitForTimeout(2200);

  // 2. Point to Diameter selector
  await moveCursor(page, 340, 20, true);
  await page.evaluate(() => {
    const sel = document.querySelectorAll('select')[1];
    if (sel) { sel.value = '4"'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await updateSubtitle(page, 'Fijamos el diámetro nominal en 4 pulgadas.');
  await page.waitForTimeout(2000);

  // 3. Click "Caño" button
  await moveCursor(page, 300, 680, true);
  await updateSubtitle(page, 'Seleccionamos la herramienta "Cañería" en la paleta inferior de componentes.');
  await page.waitForTimeout(2000);

  // 4. Click Direction +X and Trazar
  await moveCursor(page, 1070, 520, true);
  await updateSubtitle(page, 'Definimos dirección +X y longitud de 1000 mm. Presionamos TRAZAR.');
  await moveCursor(page, 1190, 685, true);
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('TRAZAR'));
    if (btn) btn.click();
  });
  await page.waitForTimeout(2500);

  // 5. Click Codo 90 and change direction +Y
  await moveCursor(page, 360, 680, true);
  await updateSubtitle(page, 'Insertamos un Codo a 90° de Radio Largo (LR) con espesores Sch 40 automáticos.');
  await page.waitForTimeout(2000);
  await moveCursor(page, 1010, 480, true);
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('+Y'));
    if (btn) btn.click();
  });
  await moveCursor(page, 1190, 685, true);
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('TRAZAR'));
    if (btn) btn.click();
  });
  await page.waitForTimeout(2500);

  // 6. Smooth orbit camera
  await updateSubtitle(page, 'Orbitamos el modelo en 3D: dimensiones exactas y geometría normalizada ASME B16.9.');
  await page.mouse.move(640, 360);
  await page.mouse.down({ button: 'left' });
  for (let i = 0; i < 20; i++) {
    await page.mouse.move(640 + i * 15, 360 + Math.sin(i / 3) * 30);
    await page.waitForTimeout(60);
  }
  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(2000);

  await context.close();
  const file = fs.readdirSync(tempDir)[0];
  const dest = path.join(outDir, 'Tutorial_01_Ruteo_3D_y_Codos.webm');
  fs.copyFileSync(path.join(tempDir, file), dest);
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log('Video 1 listo:', dest);
}

// ---------------- VIDEO 2 ----------------
async function recordVideo2(browser) {
  console.log('--- Grabando Video 2: Bridas y Válvulas con Snap Magnético ---');
  const tempDir = path.resolve('scratch/v2_temp');
  fs.mkdirSync(tempDir, { recursive: true });

  const context = await browser.newContext({
    recordVideo: { dir: tempDir, size: { width: 1280, height: 720 } },
    viewport: { width: 1280, height: 720 }
  });
  const page = await context.newPage();
  await page.goto('https://achero-plant-3d.vercel.app');
  await page.waitForLoadState('networkidle');

  await injectOverlay(page, 'Módulo 2: Inserción de Bridas WN y Válvulas de Bloqueo', 'Acoplamos accesorios bridados y válvulas con alineación y reconocimiento de cara RF.');
  await page.waitForTimeout(2000);

  // Trazar caño base primero
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('TRAZAR'));
    if (btn) btn.click();
  });
  await page.waitForTimeout(1500);

  // Seleccionar Brida WN
  await moveCursor(page, 480, 680, true);
  await updateSubtitle(page, 'Seleccionamos la Brida Cuello Soldable (Weld Neck) Class 150# RF.');
  await page.waitForTimeout(2000);
  await moveCursor(page, 1190, 685, true);
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('TRAZAR'));
    if (btn) btn.click();
  });
  await page.waitForTimeout(2000);

  // Seleccionar Válvula Ball Valve
  await moveCursor(page, 620, 680, true);
  await updateSubtitle(page, 'Seleccionamos la Válvula Esférica (Ball Valve). El snap magnético empareja las caras bridadas.');
  await page.waitForTimeout(2000);
  await moveCursor(page, 1190, 685, true);
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('TRAZAR'));
    if (btn) btn.click();
  });
  await page.waitForTimeout(2500);

  // Abrir panel Propiedades
  await moveCursor(page, 440, 20, true);
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Propiedades'));
    if (btn) btn.click();
  });
  await updateSubtitle(page, 'En el Inspector de Propiedades verificamos longitud cara a cara, rating y especificación.');
  await page.waitForTimeout(3000);

  await context.close();
  const file = fs.readdirSync(tempDir)[0];
  const dest = path.join(outDir, 'Tutorial_02_Valvulas_y_Bridas.webm');
  fs.copyFileSync(path.join(tempDir, file), dest);
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log('Video 2 listo:', dest);
}

// ---------------- VIDEO 3 ----------------
async function recordVideo3(browser) {
  console.log('--- Grabando Video 3: Spooling de Taller y Field Welds ---');
  const tempDir = path.resolve('scratch/v3_temp');
  fs.mkdirSync(tempDir, { recursive: true });

  const context = await browser.newContext({
    recordVideo: { dir: tempDir, size: { width: 1280, height: 720 } },
    viewport: { width: 1280, height: 720 }
  });
  const page = await context.newPage();
  await page.goto('https://achero-plant-3d.vercel.app');
  await page.waitForLoadState('networkidle');

  await injectOverlay(page, 'Módulo 3: División de Spools y Soldaduras de Campo', 'Organizamos los conjuntos de tubería prefabricables en taller delimitados por Field Welds.');
  await page.waitForTimeout(2000);

  // Trazar un tramo con curva
  await page.evaluate(() => {
    const tr = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('TRAZAR'));
    if (tr) { tr.click(); }
  });
  await page.waitForTimeout(1000);

  // Clic en botón "Spools"
  await moveCursor(page, 770, 20, true);
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Spools'));
    if (btn) btn.click();
  });
  await updateSubtitle(page, 'Abrimos el Gestor de Spools: cada conjunto recibe un identificador único (SP-01, SP-02).');
  await page.waitForTimeout(3500);

  await updateSubtitle(page, 'Las soldaduras de campo (Field Welds) incorporan sobrelongitud de ajuste para montaje en obra.');
  await page.waitForTimeout(3000);

  await context.close();
  const file = fs.readdirSync(tempDir)[0];
  const dest = path.join(outDir, 'Tutorial_03_Spools_y_Costuras_Campo.webm');
  fs.copyFileSync(path.join(tempDir, file), dest);
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log('Video 3 listo:', dest);
}

// ---------------- VIDEO 4 ----------------
async function recordVideo4(browser) {
  console.log('--- Grabando Video 4: Lista de Cortes (BOM) e Isométricos PDF ---');
  const tempDir = path.resolve('scratch/v4_temp');
  fs.mkdirSync(tempDir, { recursive: true });

  const context = await browser.newContext({
    recordVideo: { dir: tempDir, size: { width: 1280, height: 720 } },
    viewport: { width: 1280, height: 720 }
  });
  const page = await context.newPage();
  await page.goto('https://achero-plant-3d.vercel.app');
  await page.waitForLoadState('networkidle');

  await injectOverlay(page, 'Módulo 4: Cómputo de Materiales (BOM) y Emisión de Isométricos', 'Generación de listas de corte de cañería con pesos estimados y exportación de planos PDF.');
  await page.waitForTimeout(2000);

  // Clic en Lista de Cortes
  await moveCursor(page, 850, 20, true);
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Lista de Cortes'));
    if (btn) btn.click();
  });
  await updateSubtitle(page, 'Visualizamos el Cómputo BOM: metros lineales de corte, accesorios soldados y bulonería requerida.');
  await page.waitForTimeout(3500);

  // Cerrar y abrir Iso / DXF
  await moveCursor(page, 940, 20, true);
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Iso / DXF'));
    if (btn) btn.click();
  });
  await updateSubtitle(page, 'El generador de Isométricos emite planos vectoriales A4/A3 con cotas y cuadro de rotulación.');
  await page.waitForTimeout(3500);

  await context.close();
  const file = fs.readdirSync(tempDir)[0];
  const dest = path.join(outDir, 'Tutorial_04_Isometrico_PDF_y_BOM.webm');
  fs.copyFileSync(path.join(tempDir, file), dest);
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log('Video 4 listo:', dest);
}

// ---------------- VIDEO 5 ----------------
async function recordVideo5(browser) {
  console.log('--- Grabando Video 5: PCF Lossless y Operación en Campo PWA ---');
  const tempDir = path.resolve('scratch/v5_temp');
  fs.mkdirSync(tempDir, { recursive: true });

  const context = await browser.newContext({
    recordVideo: { dir: tempDir, size: { width: 1280, height: 720 } },
    viewport: { width: 1280, height: 720 }
  });
  const page = await context.newPage();
  await page.goto('https://achero-plant-3d.vercel.app');
  await page.waitForLoadState('networkidle');

  await injectOverlay(page, 'Módulo 5: Intercambio PCF y Operación en Campo (PWA Offline)', 'Importación/exportación con AutoCAD Plant 3D y trabajo 100% sin internet en obra.');
  await page.waitForTimeout(2000);

  // Abrir PCF
  await moveCursor(page, 550, 20, true);
  await updateSubtitle(page, 'Importación directa de archivos PCF de AutoCAD Plant 3D con tolerancia cero a pérdidas.');
  await page.waitForTimeout(2500);

  // Clic en Campo
  await moveCursor(page, 175, 20, true);
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Campo'));
    if (btn) btn.click();
  });
  await updateSubtitle(page, 'Módulo de Campo PWA: guardado en IndexedDB local, registro de cambios en terreno y reporte PDF.');
  await page.waitForTimeout(4000);

  await context.close();
  const file = fs.readdirSync(tempDir)[0];
  const dest = path.join(outDir, 'Tutorial_05_PCF_Lossless_y_Modo_Campo.webm');
  fs.copyFileSync(path.join(tempDir, file), dest);
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log('Video 5 listo:', dest);
}

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true
  });
  await recordVideo1(browser);
  await recordVideo2(browser);
  await recordVideo3(browser);
  await recordVideo4(browser);
  await recordVideo5(browser);
  await browser.close();
  console.log('¡TODOS LOS VIDEOS FUERON GENERADOS CON ÉXITO EN:', outDir);
})();
