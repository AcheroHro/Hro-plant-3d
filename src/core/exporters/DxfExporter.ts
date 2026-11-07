import { PipingGraph } from '../graph/PipingGraph';
import { Component } from '../../types/piping';

export type DxfViewType = 'ISO' | 'TOP' | 'FRONT' | 'SIDE' | 'ALL';

interface Point2D {
  x: number;
  y: number;
}

const COS30 = Math.cos(Math.PI / 6); // ~0.8660254
const SIN30 = Math.sin(Math.PI / 6); // 0.5

/**
 * Exportador de planos 2D Ortogonales e Isométricos (IsoGen / PnPIsoFrustum style)
 * en formato DXF estándar (AutoCAD R12 / 2000 ASCII).
 * Genera capas técnicas independientes: CENTERLINE, PIPING_CONTOUR, DIMENSIONS,
 * WELD_MARKS, ISO_ANNOTATIONS y tablas gráficas de Cómputo de Materiales (incluyendo
 * Juntas y Espárragos P3dJoint) y Lista de Cortes Individuales compatible con AutoCAD Plant 3D.
 */
export class DxfExporter {
  /**
   * Genera el archivo DXF completo a partir del PipingGraph
   */
  public static exportToDxf(
    graph: PipingGraph,
    view: DxfViewType = 'ISO',
    drawingTitle: string = 'ACHERO_PLANT_3D_ISOMETRIC'
  ): string {
    const lines: string[] = [];

    // 1. SECCIÓN HEADER
    lines.push(
      '0',
      'SECTION',
      '2',
      'HEADER',
      '9',
      '$ACADVER',
      '1',
      'AC1009', // AutoCAD R12 ASCII universal
      '9',
      '$INSUNITS',
      '70',
      '4', // 4 = Milímetros (mm)
      '0',
      'ENDSEC'
    );

    // 2. SECCIÓN TABLES (LINETYPE y LAYER)
    lines.push(
      '0',
      'SECTION',
      '2',
      'TABLES',
      // Tabla LTYPE
      '0',
      'TABLE',
      '2',
      'LTYPE',
      '70',
      '2',
      '0',
      'LTYPE',
      '2',
      'CONTINUOUS',
      '70',
      '0',
      '3',
      'Solid line',
      '72',
      '65',
      '73',
      '0',
      '40',
      '0.0',
      '0',
      'LTYPE',
      '2',
      'CENTER',
      '70',
      '0',
      '3',
      'Center line ____ _ ____',
      '72',
      '65',
      '73',
      '4',
      '40',
      '20.0',
      '49',
      '12.0',
      '49',
      '-2.5',
      '49',
      '2.5',
      '49',
      '-2.5',
      '0',
      'ENDTAB',
      // Tabla LAYER
      '0',
      'TABLE',
      '2',
      'LAYER',
      '70',
      '7',
      // Capa 0
      '0',
      'LAYER',
      '2',
      '0',
      '70',
      '0',
      '62',
      '7', // Blanco
      '6',
      'CONTINUOUS',
      // Capa CENTERLINE
      '0',
      'LAYER',
      '2',
      'CENTERLINE',
      '70',
      '0',
      '62',
      '1', // Rojo
      '6',
      'CENTER',
      // Capa PIPING_CONTOUR
      '0',
      'LAYER',
      '2',
      'PIPING_CONTOUR',
      '70',
      '0',
      '62',
      '7', // Blanco
      '6',
      'CONTINUOUS',
      // Capa DIMENSIONS
      '0',
      'LAYER',
      '2',
      'DIMENSIONS',
      '70',
      '0',
      '62',
      '3', // Verde
      '6',
      'CONTINUOUS',
      // Capa WELD_MARKS
      '0',
      'LAYER',
      '2',
      'WELD_MARKS',
      '70',
      '0',
      '62',
      '2', // Amarillo (Soldaduras / Bridas)
      '6',
      'CONTINUOUS',
      // Capa ISO_ANNOTATIONS
      '0',
      'LAYER',
      '2',
      'ISO_ANNOTATIONS',
      '70',
      '0',
      '62',
      '6', // Magenta (Globos de corte y elevaciones)
      '6',
      'CONTINUOUS',
      // Capa BOM_TABLE
      '0',
      'LAYER',
      '2',
      'BOM_TABLE',
      '70',
      '0',
      '62',
      '4', // Cian
      '6',
      'CONTINUOUS',
      '0',
      'ENDTAB',
      '0',
      'ENDSEC'
    );

    // 3. SECCIÓN ENTITIES
    lines.push('0', 'SECTION', '2', 'ENTITIES');

    let maxX = 1800;
    const minY = -300;

    if (view === 'ALL') {
      const offset = 2600;
      DxfExporter.renderViewEntities(
        lines,
        graph,
        'ISO',
        { x: offset, y: offset },
        'PROYECCIÓN ISOMÉTRICA 3D (NORMA ISOGEN 30°/150°)'
      );
      DxfExporter.renderViewEntities(lines, graph, 'TOP', { x: 0, y: offset }, 'VISTA DE PLANTA (XY)');
      DxfExporter.renderViewEntities(lines, graph, 'FRONT', { x: 0, y: 0 }, 'ALZADO FRONTAL (XZ)');
      DxfExporter.renderViewEntities(lines, graph, 'SIDE', { x: offset, y: 0 }, 'PERFIL LATERAL (YZ)');
      maxX = offset * 2 + 400;
    } else {
      const title =
        view === 'ISO'
          ? 'PROYECCIÓN ISOMÉTRICA 2D CON COTAS Y SOLDADURAS (ISOGEN)'
          : view === 'TOP'
          ? 'VISTA DE PLANTA (XY)'
          : view === 'FRONT'
          ? 'ALZADO FRONTAL (XZ)'
          : 'PERFIL LATERAL (YZ)';
      DxfExporter.renderViewEntities(lines, graph, view, { x: 0, y: 0 }, title);
      maxX = 2200;
    }

    // Dibujar Tabla 1: Cómputo de Materiales + Juntas y Espárragos P3dJoint (BOM)
    const nextTableY = DxfExporter.renderBomTable(lines, graph, { x: maxX + 300, y: 1800 });

    // Dibujar Tabla 2: Lista de Cortes Individuales de Cañería (Spool Cut List)
    const bottomTableY = DxfExporter.renderCutListTable(lines, graph, {
      x: maxX + 300,
      y: nextTableY - 140
    });

    // Dibujar Rótulo Técnico AutoCAD Plant 3D
    DxfExporter.renderTitleBlock(
      lines,
      graph,
      drawingTitle,
      view,
      { x: maxX + 300, y: bottomTableY - 120 }
    );

    // Rótulo general inferior
    DxfExporter.addText(lines, '0', -200, minY - 100, 35, 0, `AUTOCAD PLANT 3D / ACHERO - ${drawingTitle}`);
    DxfExporter.addText(
      lines,
      '0',
      -200,
      minY - 150,
      20,
      0,
      `ESCALA 1:1 (COTAS EN MM) • SPEC: ${graph.activeSpec} • P3DJOINT ACTIVE`
    );

    lines.push('0', 'ENDSEC');

    // 4. FIN DEL ARCHIVO
    lines.push('0', 'EOF', '');

    return lines.join('\n');
  }

  /**
   * Renderiza las entidades 2D de una vista específica con offset de lámina
   */
  private static renderViewEntities(
    lines: string[],
    graph: PipingGraph,
    view: 'ISO' | 'TOP' | 'FRONT' | 'SIDE',
    sheetOffset: Point2D,
    title: string
  ): void {
    // Título de la vista
    DxfExporter.addText(lines, '0', sheetOffset.x, sheetOffset.y - 160, 28, 0, title);
    DxfExporter.addLine(lines, '0', sheetOffset.x, sheetOffset.y - 175, sheetOffset.x + 950, sheetOffset.y - 175);

    // Si es vista Isométrica, dibujar Rosa de los Vientos Isométrica (Norte +Y, Este +X, Elev +Z)
    if (view === 'ISO') {
      DxfExporter.renderIsoNorthArrow(lines, { x: sheetOffset.x - 250, y: sheetOffset.y + 900 });
    }

    let pipeCutIndex = 1;
    for (const comp of graph.components.values()) {
      switch (comp.type) {
        case 'PIPE':
          DxfExporter.renderPipe2D(lines, comp, view, sheetOffset, pipeCutIndex++);
          break;
        case 'ELBOW':
          DxfExporter.renderElbow2D(lines, comp, view, sheetOffset);
          break;
        case 'TEE':
          DxfExporter.renderTee2D(lines, comp, view, sheetOffset);
          break;
        case 'FLANGE':
          DxfExporter.renderFlange2D(lines, comp, view, sheetOffset);
          break;
        case 'VALVE':
          DxfExporter.renderValve2D(lines, comp, view, sheetOffset);
          break;
        case 'REDUCER':
          DxfExporter.renderReducer2D(lines, comp, view, sheetOffset);
          break;
        case 'CAP':
          DxfExporter.renderCap2D(lines, comp, view, sheetOffset);
          break;
        default: {
          // Olets, instrumentos, cuplas y cruces importados de PCF: su eje (el detalle va en la fase de planos)
          const pts = comp.type === 'CROSS' && comp.centerline.length >= 3
            ? comp.ports.flatMap((p) => [comp.centerline[1], p.position])
            : comp.centerline;
          for (let i = 0; i + 1 < pts.length; i += comp.type === 'CROSS' ? 2 : 1) {
            const a = DxfExporter.projectPoint(pts[i], view, sheetOffset);
            const b = DxfExporter.projectPoint(pts[i + 1], view, sheetOffset);
            DxfExporter.addLine(lines, '0', a.x, a.y, b.x, b.y);
          }
        }
      }
    }
  }

  /**
   * Dibuja el indicador de Norte Isométrico (+Y a +30°, +X a -30°, +Z vertical)
   */
  private static renderIsoNorthArrow(lines: string[], origin: Point2D): void {
    const len = 140;
    const nx = origin.x + len * COS30;
    const ny = origin.y + len * SIN30;
    const ex = origin.x + len * COS30;
    const ey = origin.y - len * SIN30;
    const zx = origin.x;
    const zy = origin.y + len;

    // Eje Norte (+Y) con flecha destacada
    DxfExporter.addLine(lines, 'ISO_ANNOTATIONS', origin.x, origin.y, nx, ny);
    DxfExporter.addLine(lines, 'ISO_ANNOTATIONS', nx, ny, nx - 28 * COS30, ny - 10 * SIN30);
    DxfExporter.addLine(lines, 'ISO_ANNOTATIONS', nx, ny, nx - 15 * COS30, ny - 28 * SIN30);
    DxfExporter.addText(lines, 'ISO_ANNOTATIONS', nx + 12, ny + 8, 20, 30, 'NORTE (+Y)');

    // Eje Este (+X)
    DxfExporter.addLine(lines, 'ISO_ANNOTATIONS', origin.x, origin.y, ex, ey);
    DxfExporter.addText(lines, 'ISO_ANNOTATIONS', ex + 10, ey - 15, 16, -30, '+X (E)');

    // Eje Elevación (+Z)
    DxfExporter.addLine(lines, 'ISO_ANNOTATIONS', origin.x, origin.y, zx, zy);
    DxfExporter.addText(lines, 'ISO_ANNOTATIONS', zx - 25, zy + 15, 16, 0, '+Z (EL)');
  }

  /**
   * Dibuja Tabla 1: Cómputo de Materiales, Accesorios, Juntas y Espárragos (BOM)
   */
  private static renderBomTable(lines: string[], graph: PipingGraph, start: Point2D): number {
    const bom = graph.calculateBillOfMaterials();
    const tableWidth = 1450;
    const rowHeight = 65;
    const colX = [0, 210, 920, 1060, 1190, 1450]; // Columnas: Tipo, Descripción, ND, Cant, Corte Neto

    let currentY = start.y;

    // Título de la tabla
    DxfExporter.addText(
      lines,
      'BOM_TABLE',
      start.x,
      currentY + 35,
      26,
      0,
      'LISTA DE MATERIALES, JUNTAS Y ESPARRAGOS (BOM - P3DJOINT)'
    );
    DxfExporter.addLine(lines, 'BOM_TABLE', start.x, currentY, start.x + tableWidth, currentY);

    // Cabecera de columnas
    DxfExporter.addText(lines, 'BOM_TABLE', start.x + colX[0] + 10, currentY - 42, 16, 0, 'CATEGORIA');
    DxfExporter.addText(lines, 'BOM_TABLE', start.x + colX[1] + 10, currentY - 42, 16, 0, 'DESCRIPCION TECNICA (SPEC)');
    DxfExporter.addText(lines, 'BOM_TABLE', start.x + colX[2] + 10, currentY - 42, 16, 0, 'ND');
    DxfExporter.addText(lines, 'BOM_TABLE', start.x + colX[3] + 10, currentY - 42, 16, 0, 'CANT');
    DxfExporter.addText(lines, 'BOM_TABLE', start.x + colX[4] + 10, currentY - 42, 16, 0, 'LONG. TOTAL');

    currentY -= rowHeight;
    DxfExporter.addLine(lines, 'BOM_TABLE', start.x, currentY, start.x + tableWidth, currentY);

    // Filas
    for (const item of bom) {
      const typeLabel =
        item.type === 'GASKET'
          ? 'JUNTA'
          : item.type === 'BOLT_SET'
          ? 'ESPARRAGOS'
          : item.type;
      DxfExporter.addText(lines, 'BOM_TABLE', start.x + colX[0] + 10, currentY - 42, 15, 0, typeLabel);
      DxfExporter.addText(
        lines,
        'BOM_TABLE',
        start.x + colX[1] + 10,
        currentY - 42,
        13,
        0,
        item.description.substring(0, 48)
      );
      DxfExporter.addText(lines, 'BOM_TABLE', start.x + colX[2] + 10, currentY - 42, 15, 0, `${item.nominalDiameter}"`);
      DxfExporter.addText(lines, 'BOM_TABLE', start.x + colX[3] + 10, currentY - 42, 15, 0, String(item.quantity));
      const cutStr = item.totalCutLengthMm > 0 ? `${item.totalCutLengthMm.toFixed(1)} mm` : 'UNIDAD';
      DxfExporter.addText(lines, 'BOM_TABLE', start.x + colX[4] + 10, currentY - 42, 15, 0, cutStr);

      currentY -= rowHeight;
      DxfExporter.addLine(lines, 'BOM_TABLE', start.x, currentY, start.x + tableWidth, currentY);
    }

    // Líneas verticales de la tabla
    for (const c of colX) {
      DxfExporter.addLine(lines, 'BOM_TABLE', start.x + c, start.y, start.x + c, currentY);
    }

    return currentY;
  }

  /**
   * Dibuja Tabla 2: Lista de Cortes Individuales de Cañería para Taller (Pipe Cut List)
   */
  private static renderCutListTable(lines: string[], graph: PipingGraph, start: Point2D): number {
    const cutList = graph.calculatePipeCutList();
    const tableWidth = 1450;
    const rowHeight = 60;
    const colX = [0, 160, 320, 520, 960, 1200, 1450];

    let currentY = start.y;

    DxfExporter.addText(
      lines,
      'BOM_TABLE',
      start.x,
      currentY + 32,
      24,
      0,
      'PLANILLA DE CORTES INDIVIDUALES DE CANERIA (PIPE CUT LIST)'
    );
    DxfExporter.addLine(lines, 'BOM_TABLE', start.x, currentY, start.x + tableWidth, currentY);

    // Cabecera: Identificación (N.º Niple), Diámetro, Largo (mm), Extremo 1, Extremo 2, Material
    DxfExporter.addText(lines, 'BOM_TABLE', start.x + colX[0] + 10, currentY - 40, 15, 0, 'NRO NIPLE');
    DxfExporter.addText(lines, 'BOM_TABLE', start.x + colX[1] + 10, currentY - 40, 15, 0, 'DIAM');
    DxfExporter.addText(lines, 'BOM_TABLE', start.x + colX[2] + 10, currentY - 40, 15, 0, 'LARGO (MM)');
    DxfExporter.addText(lines, 'BOM_TABLE', start.x + colX[3] + 10, currentY - 40, 15, 0, 'MATERIAL / SPEC');
    DxfExporter.addText(lines, 'BOM_TABLE', start.x + colX[4] + 10, currentY - 40, 15, 0, 'EXTREMO 1');
    DxfExporter.addText(lines, 'BOM_TABLE', start.x + colX[5] + 10, currentY - 40, 15, 0, 'EXTREMO 2');

    currentY -= rowHeight;
    DxfExporter.addLine(lines, 'BOM_TABLE', start.x, currentY, start.x + tableWidth, currentY);

    for (const cut of cutList) {
      DxfExporter.addText(
        lines,
        'BOM_TABLE',
        start.x + colX[0] + 10,
        currentY - 40,
        15,
        0,
        `${cut.nippleId} (C-${cut.itemNumber})`
      );
      DxfExporter.addText(lines, 'BOM_TABLE', start.x + colX[1] + 10, currentY - 40, 15, 0, `${cut.nominalDiameter}"`);
      DxfExporter.addText(
        lines,
        'BOM_TABLE',
        start.x + colX[2] + 10,
        currentY - 40,
        16,
        0,
        `${Math.round(cut.cutLengthMm)} mm`
      );
      DxfExporter.addText(
        lines,
        'BOM_TABLE',
        start.x + colX[3] + 10,
        currentY - 40,
        13,
        0,
        cut.description.substring(0, 28)
      );
      DxfExporter.addText(
        lines,
        'BOM_TABLE',
        start.x + colX[4] + 10,
        currentY - 40,
        15,
        0,
        cut.endFinish1.toUpperCase()
      );
      DxfExporter.addText(
        lines,
        'BOM_TABLE',
        start.x + colX[5] + 10,
        currentY - 40,
        15,
        0,
        cut.endFinish2.toUpperCase()
      );

      currentY -= rowHeight;
      DxfExporter.addLine(lines, 'BOM_TABLE', start.x, currentY, start.x + tableWidth, currentY);
    }

    for (const c of colX) {
      DxfExporter.addLine(lines, 'BOM_TABLE', start.x + c, start.y, start.x + c, currentY);
    }

    return currentY;
  }

  /**
   * Dibuja el Rótulo de Ingeniería estilo AutoCAD Plant 3D 2027
   */
  private static renderTitleBlock(
    lines: string[],
    graph: PipingGraph,
    drawingTitle: string,
    view: DxfViewType,
    start: Point2D
  ): void {
    const w = 1450;
    const h = 220;
    const x = start.x;
    const y = start.y;

    // Marco exterior
    DxfExporter.addLine(lines, '0', x, y, x + w, y);
    DxfExporter.addLine(lines, '0', x, y - h, x + w, y - h);
    DxfExporter.addLine(lines, '0', x, y, x, y - h);
    DxfExporter.addLine(lines, '0', x + w, y, x + w, y - h);
    DxfExporter.addLine(lines, '0', x, y - 110, x + w, y - 110);
    DxfExporter.addLine(lines, '0', x + 900, y, x + 900, y - h);

    DxfExporter.addText(lines, '0', x + 25, y - 50, 24, 0, `PROYECTO: ACHERO PLANT 3D • LINEA: ${drawingTitle}`);
    DxfExporter.addText(lines, '0', x + 25, y - 88, 16, 0, `NORMA: ASME B31.3 / B16.9 / B16.5 • UNIDADES: MILIMETROS (MM)`);
    DxfExporter.addText(lines, '0', x + 25, y - 165, 18, 0, `VISTA ACTIVA: ${view} • PIEZAS TOTALES: ${graph.components.size}`);
    DxfExporter.addText(lines, '0', x + 925, y - 55, 22, 0, `SPEC: ${graph.activeSpec}`);
    DxfExporter.addText(lines, '0', x + 925, y - 165, 18, 0, `REV: A • ESCALA: S/E`);
  }

  /**
   * Proyecta un punto 3D al plano 2D según la vista seleccionada (incluyendo Isométrica 30°/150°)
   */
  private static projectPoint(
    pt3D: { x: number; y: number; z: number },
    view: 'ISO' | 'TOP' | 'FRONT' | 'SIDE',
    offset: Point2D
  ): Point2D {
    switch (view) {
      case 'ISO':
        // Proyección Isométrica CAD: +X a -30° (abajo-derecha), +Y a +30° (arriba-derecha), +Z vertical (+90°)
        return {
          x: (pt3D.x + pt3D.y) * COS30 + offset.x,
          y: pt3D.z + (pt3D.y - pt3D.x) * SIN30 + offset.y
        };
      case 'TOP':
        return { x: pt3D.x + offset.x, y: pt3D.y + offset.y };
      case 'FRONT':
        return { x: pt3D.x + offset.x, y: pt3D.z + offset.y };
      case 'SIDE':
        return { x: pt3D.y + offset.x, y: pt3D.z + offset.y };
    }
  }

  /**
   * Dibuja una línea de cota CAD completa con líneas de referencia, flechas/ticks y texto alineado
   */
  private static renderCadDimension(
    lines: string[],
    p1: Point2D,
    p2: Point2D,
    offsetDist: number,
    labelText: string
  ): void {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < 5) return;

    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;

    // Puntos sobre la línea de cota desplazada
    const d1x = p1.x + nx * offsetDist;
    const d1y = p1.y + ny * offsetDist;
    const d2x = p2.x + nx * offsetDist;
    const d2y = p2.y + ny * offsetDist;

    // Líneas de extensión
    const extOver = offsetDist >= 0 ? 15 : -15;
    DxfExporter.addLine(lines, 'DIMENSIONS', p1.x + nx * 10, p1.y + ny * 10, d1x + nx * extOver, d1y + ny * extOver);
    DxfExporter.addLine(lines, 'DIMENSIONS', p2.x + nx * 10, p2.y + ny * 10, d2x + nx * extOver, d2y + ny * extOver);

    // Línea principal de cota
    DxfExporter.addLine(lines, 'DIMENSIONS', d1x, d1y, d2x, d2y);

    // Ticks oblicuos de arquitectura/piping en ambos extremos
    const tick = 12;
    DxfExporter.addLine(
      lines,
      'DIMENSIONS',
      d1x - (ux + nx) * tick,
      d1y - (uy + ny) * tick,
      d1x + (ux + nx) * tick,
      d1y + (uy + ny) * tick
    );
    DxfExporter.addLine(
      lines,
      'DIMENSIONS',
      d2x - (ux + nx) * tick,
      d2y - (uy + ny) * tick,
      d2x + (ux + nx) * tick,
      d2y + (uy + ny) * tick
    );

    // Texto de cota centrado y legible
    let textAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (textAngle > 90) textAngle -= 180;
    if (textAngle < -90) textAngle += 180;

    const midX = (d1x + d2x) / 2 + nx * 14;
    const midY = (d1y + d2y) / 2 + ny * 14;
    DxfExporter.addText(lines, 'DIMENSIONS', midX - 45, midY, 18, textAngle, labelText);
  }

  private static renderPipe2D(
    lines: string[],
    comp: Component,
    view: 'ISO' | 'TOP' | 'FRONT' | 'SIDE',
    offset: Point2D,
    cutIndex: number
  ): void {
    if (comp.ports.length < 2) return;

    const p1_3D = comp.ports[0].position;
    const p2_3D = comp.ports[1].position;

    const p1 = DxfExporter.projectPoint(p1_3D, view, offset);
    const p2 = DxfExporter.projectPoint(p2_3D, view, offset);

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len2D = Math.sqrt(dx * dx + dy * dy);

    const od = comp.parameters.outerDiameter || 60.3;
    const radius = od / 2;

    if (len2D < 1.0) {
      // El caño se ve de punta (sección circular)
      DxfExporter.addCircle(lines, 'PIPING_CONTOUR', p1.x, p1.y, radius);
      DxfExporter.addCircle(lines, 'PIPING_CONTOUR', p1.x, p1.y, radius - (comp.parameters.wallThickness || 3.91));
      DxfExporter.addLine(lines, 'CENTERLINE', p1.x - radius * 1.3, p1.y, p1.x + radius * 1.3, p1.y);
      DxfExporter.addLine(lines, 'CENTERLINE', p1.x, p1.y - radius * 1.3, p1.x, p1.y + radius * 1.3);
      return;
    }

    // 1. Línea de eje en capa CENTERLINE
    DxfExporter.addLine(lines, 'CENTERLINE', p1.x, p1.y, p2.x, p2.y);

    // Vector normal unitario perpendicular al eje 2D
    const nx = -dy / len2D;
    const ny = dx / len2D;

    // 2. Contorno exterior de tubería (paredes dobles)
    DxfExporter.addLine(
      lines,
      'PIPING_CONTOUR',
      p1.x + nx * radius,
      p1.y + ny * radius,
      p2.x + nx * radius,
      p2.y + ny * radius
    );
    DxfExporter.addLine(
      lines,
      'PIPING_CONTOUR',
      p1.x - nx * radius,
      p1.y - ny * radius,
      p2.x - nx * radius,
      p2.y - ny * radius
    );

    // 3. Tapas / extremos perpendiculares y puntos de soldadura
    DxfExporter.addLine(
      lines,
      'PIPING_CONTOUR',
      p1.x + nx * radius,
      p1.y + ny * radius,
      p1.x - nx * radius,
      p1.y - ny * radius
    );
    DxfExporter.addLine(
      lines,
      'PIPING_CONTOUR',
      p2.x + nx * radius,
      p2.y + ny * radius,
      p2.x - nx * radius,
      p2.y - ny * radius
    );

    // Puntos de soldadura en extremos (capa WELD_MARKS)
    DxfExporter.addCircle(lines, 'WELD_MARKS', p1.x, p1.y, 6);
    DxfExporter.addCircle(lines, 'WELD_MARKS', p2.x, p2.y, 6);

    // 4. Línea de Cota CAD completa con longitud de corte neta
    const cutLen = comp.parameters.cutLength || comp.parameters.grossLength || len2D;
    const dimOffset = radius + 65;
    DxfExporter.renderCadDimension(
      lines,
      p1,
      p2,
      dimOffset,
      `L=${cutLen.toFixed(1)} mm (${comp.parameters.nominalDiameter}")`
    );

    // 5. Globo de Spool / Corte (C-1, C-2...) en capa ISO_ANNOTATIONS
    const midX = (p1.x + p2.x) / 2 - nx * (radius + 55);
    const midY = (p1.y + p2.y) / 2 - ny * (radius + 55);
    DxfExporter.addCircle(lines, 'ISO_ANNOTATIONS', midX, midY, 26);
    DxfExporter.addText(lines, 'ISO_ANNOTATIONS', midX - 16, midY - 7, 15, 0, `C-${cutIndex}`);
  }

  private static renderElbow2D(
    lines: string[],
    comp: Component,
    view: 'ISO' | 'TOP' | 'FRONT' | 'SIDE',
    offset: Point2D
  ): void {
    if (comp.centerline.length < 2) return;

    const od = comp.parameters.outerDiameter || 60.3;
    const radius = od / 2;

    // Línea de eje y bordes del codo proyectados
    for (let i = 0; i < comp.centerline.length - 1; i++) {
      const pA = DxfExporter.projectPoint(comp.centerline[i], view, offset);
      const pB = DxfExporter.projectPoint(comp.centerline[i + 1], view, offset);
      DxfExporter.addLine(lines, 'CENTERLINE', pA.x, pA.y, pB.x, pB.y);

      const dx = pB.x - pA.x;
      const dy = pB.y - pA.y;
      const segLen = Math.hypot(dx, dy);
      if (segLen > 0.5) {
        const nx = -dy / segLen;
        const ny = dx / segLen;
        DxfExporter.addLine(
          lines,
          'PIPING_CONTOUR',
          pA.x + nx * radius,
          pA.y + ny * radius,
          pB.x + nx * radius,
          pB.y + ny * radius
        );
        DxfExporter.addLine(
          lines,
          'PIPING_CONTOUR',
          pA.x - nx * radius,
          pA.y - ny * radius,
          pB.x - nx * radius,
          pB.y - ny * radius
        );
      }
    }

    // Puertos y marcas de soldadura en los extremos
    if (comp.ports.length >= 2) {
      const p1 = DxfExporter.projectPoint(comp.ports[0].position, view, offset);
      const p2 = DxfExporter.projectPoint(comp.ports[1].position, view, offset);

      DxfExporter.addCircle(lines, 'PIPING_CONTOUR', p1.x, p1.y, radius * 0.5);
      DxfExporter.addCircle(lines, 'PIPING_CONTOUR', p2.x, p2.y, radius * 0.5);
      DxfExporter.addCircle(lines, 'WELD_MARKS', p1.x, p1.y, 7);
      DxfExporter.addCircle(lines, 'WELD_MARKS', p2.x, p2.y, 7);

      // Etiqueta de codo y cota de elevación en vista Isométrica
      const midPt = comp.centerline[Math.floor(comp.centerline.length / 2)];
      const pMid = DxfExporter.projectPoint(midPt, view, offset);
      const takeOff = comp.parameters.takeOff || comp.parameters.radius || 76.2;
      DxfExporter.addText(
        lines,
        'ISO_ANNOTATIONS',
        pMid.x + 25,
        pMid.y + 25,
        14,
        0,
        `CODO ${comp.parameters.angle || 90} (T=${takeOff.toFixed(1)}mm) EL.${midPt.z >= 0 ? '+' : ''}${midPt.z.toFixed(0)}`
      );
    }
  }

  private static renderTee2D(
    lines: string[],
    comp: Component,
    view: 'ISO' | 'TOP' | 'FRONT' | 'SIDE',
    offset: Point2D
  ): void {
    if (comp.ports.length < 3) return;
    const p1 = DxfExporter.projectPoint(comp.ports[0].position, view, offset);
    const p2 = DxfExporter.projectPoint(comp.ports[1].position, view, offset);
    const p3 = DxfExporter.projectPoint(comp.ports[2].position, view, offset);
    const vertex3D = comp.centerline[1] || comp.ports[0].position;
    const v = DxfExporter.projectPoint(vertex3D, view, offset);

    // Eje principal Run y derivación Branch
    DxfExporter.addLine(lines, 'CENTERLINE', p1.x, p1.y, p2.x, p2.y);
    DxfExporter.addLine(lines, 'CENTERLINE', v.x, v.y, p3.x, p3.y);

    // Símbolo técnico de Te y marcas de soldadura
    DxfExporter.addLine(lines, 'PIPING_CONTOUR', p1.x, p1.y, p2.x, p2.y);
    DxfExporter.addLine(lines, 'PIPING_CONTOUR', v.x, v.y, p3.x, p3.y);
    DxfExporter.addCircle(lines, 'WELD_MARKS', p1.x, p1.y, 7);
    DxfExporter.addCircle(lines, 'WELD_MARKS', p2.x, p2.y, 7);
    DxfExporter.addCircle(lines, 'WELD_MARKS', p3.x, p3.y, 7);
    DxfExporter.addText(
      lines,
      'ISO_ANNOTATIONS',
      v.x + 20,
      v.y + 20,
      14,
      0,
      `TE ${comp.parameters.nominalDiameter}"`
    );
  }

  private static renderFlange2D(
    lines: string[],
    comp: Component,
    view: 'ISO' | 'TOP' | 'FRONT' | 'SIDE',
    offset: Point2D
  ): void {
    if (comp.ports.length < 2) return;
    const p1 = DxfExporter.projectPoint(comp.ports[0].position, view, offset);
    const p2 = DxfExporter.projectPoint(comp.ports[1].position, view, offset);
    const od = comp.parameters.outerDiameter || 60.3;
    const flgRadius = od * 0.85;

    DxfExporter.addLine(lines, 'CENTERLINE', p1.x, p1.y, p2.x, p2.y);
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      const nx = -dy / len;
      const ny = dx / len;
      // Plato de la brida en p2 + marca de junta (Gasket)
      DxfExporter.addLine(
        lines,
        'PIPING_CONTOUR',
        p2.x + nx * flgRadius,
        p2.y + ny * flgRadius,
        p2.x - nx * flgRadius,
        p2.y - ny * flgRadius
      );
      DxfExporter.addLine(
        lines,
        'WELD_MARKS',
        p1.x + nx * (od * 0.5),
        p1.y + ny * (od * 0.5),
        p1.x - nx * (od * 0.5),
        p1.y - ny * (od * 0.5)
      );
    }
    DxfExporter.addCircle(lines, 'WELD_MARKS', p1.x, p1.y, 6);
    DxfExporter.addText(
      lines,
      'ISO_ANNOTATIONS',
      p2.x + 15,
      p2.y + 15,
      13,
      0,
      `BRIDA ${comp.parameters.nominalDiameter}" + JUNTA/ESPARR.`
    );
  }

  private static renderValve2D(
    lines: string[],
    comp: Component,
    view: 'ISO' | 'TOP' | 'FRONT' | 'SIDE',
    offset: Point2D
  ): void {
    if (comp.ports.length < 2) return;
    const p1 = DxfExporter.projectPoint(comp.ports[0].position, view, offset);
    const p2 = DxfExporter.projectPoint(comp.ports[1].position, view, offset);
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const od = comp.parameters.outerDiameter || 60.3;
    const halfW = od * 0.7;

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      const nx = -dy / len;
      const ny = dx / len;

      // Símbolo CAD clásico de válvula (moño de dos triángulos enfrentados + vástago y volante)
      const c1a = { x: p1.x + nx * halfW, y: p1.y + ny * halfW };
      const c1b = { x: p1.x - nx * halfW, y: p1.y - ny * halfW };
      const c2a = { x: p2.x + nx * halfW, y: p2.y + ny * halfW };
      const c2b = { x: p2.x - nx * halfW, y: p2.y - ny * halfW };

      DxfExporter.addLine(lines, 'PIPING_CONTOUR', c1a.x, c1a.y, c1b.x, c1b.y);
      DxfExporter.addLine(lines, 'PIPING_CONTOUR', c2a.x, c2a.y, c2b.x, c2b.y);
      DxfExporter.addLine(lines, 'PIPING_CONTOUR', c1a.x, c1a.y, c2b.x, c2b.y);
      DxfExporter.addLine(lines, 'PIPING_CONTOUR', c1b.x, c1b.y, c2a.x, c2a.y);

      // Vástago y volante
      const stemTop = { x: mid.x + nx * (halfW * 1.8), y: mid.y + ny * (halfW * 1.8) };
      DxfExporter.addLine(lines, 'PIPING_CONTOUR', mid.x, mid.y, stemTop.x, stemTop.y);
      DxfExporter.addLine(
        lines,
        'PIPING_CONTOUR',
        stemTop.x - (dx / len) * 25,
        stemTop.y - (dy / len) * 25,
        stemTop.x + (dx / len) * 25,
        stemTop.y + (dy / len) * 25
      );

      // Cota cara a cara de la válvula
      const f2f = comp.parameters.faceToFace || 178;
      DxfExporter.renderCadDimension(lines, p1, p2, -(halfW + 50), `VALV L=${f2f.toFixed(0)} mm`);
    }
  }

  private static renderReducer2D(
    lines: string[],
    comp: Component,
    view: 'ISO' | 'TOP' | 'FRONT' | 'SIDE',
    offset: Point2D
  ): void {
    if (comp.ports.length < 2) return;
    const p1 = DxfExporter.projectPoint(comp.ports[0].position, view, offset);
    const p2 = DxfExporter.projectPoint(comp.ports[1].position, view, offset);
    const r1 = (comp.parameters.outerDiameter || 60.3) / 2;
    const r2 = (comp.parameters.reducedOuterDiameter || r1 * 0.7) / 2;

    DxfExporter.addLine(lines, 'CENTERLINE', p1.x, p1.y, p2.x, p2.y);
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      const nx = -dy / len;
      const ny = dx / len;
      DxfExporter.addLine(lines, 'PIPING_CONTOUR', p1.x + nx * r1, p1.y + ny * r1, p2.x + nx * r2, p2.y + ny * r2);
      DxfExporter.addLine(lines, 'PIPING_CONTOUR', p1.x - nx * r1, p1.y - ny * r1, p2.x - nx * r2, p2.y - ny * r2);
    }
    DxfExporter.addText(
      lines,
      'ISO_ANNOTATIONS',
      p1.x + 15,
      p1.y + 15,
      13,
      0,
      `RED ${comp.parameters.nominalDiameter}"x${comp.parameters.reducedNominalDiameter || ''}"`
    );
  }

  private static renderCap2D(
    lines: string[],
    comp: Component,
    view: 'ISO' | 'TOP' | 'FRONT' | 'SIDE',
    offset: Point2D
  ): void {
    if (comp.ports.length < 1) return;
    const p1 = DxfExporter.projectPoint(comp.ports[0].position, view, offset);
    const r = (comp.parameters.outerDiameter || 60.3) / 2;
    DxfExporter.addCircle(lines, 'PIPING_CONTOUR', p1.x, p1.y, r);
    DxfExporter.addText(lines, 'ISO_ANNOTATIONS', p1.x + 15, p1.y + 15, 13, 0, `CAP ${comp.parameters.nominalDiameter}"`);
  }

  // --- PRIMITIVAS DXF R12 ---

  private static addLine(
    lines: string[],
    layer: string,
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ): void {
    lines.push(
      '0',
      'LINE',
      '8',
      layer,
      '10',
      x1.toFixed(3),
      '20',
      y1.toFixed(3),
      '30',
      '0.0',
      '11',
      x2.toFixed(3),
      '21',
      y2.toFixed(3),
      '31',
      '0.0'
    );
  }

  private static addCircle(
    lines: string[],
    layer: string,
    cx: number,
    cy: number,
    radius: number
  ): void {
    lines.push(
      '0',
      'CIRCLE',
      '8',
      layer,
      '10',
      cx.toFixed(3),
      '20',
      cy.toFixed(3),
      '30',
      '0.0',
      '40',
      radius.toFixed(3)
    );
  }

  private static addText(
    lines: string[],
    layer: string,
    x: number,
    y: number,
    height: number,
    rotationDeg: number,
    text: string
  ): void {
    lines.push(
      '0',
      'TEXT',
      '8',
      layer,
      '10',
      x.toFixed(3),
      '20',
      y.toFixed(3),
      '30',
      '0.0',
      '40',
      height.toFixed(1),
      '1',
      text,
      '50',
      rotationDeg.toFixed(1)
    );
  }
}
