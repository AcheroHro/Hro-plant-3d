Este es el Prompt Maestro Definitivo (Master System Directive) optimizado para alimentar a los agentes autónomos de Google Antigravity. Está diseñado bajo el estándar de ingeniería de software para evitar desvíos, alucinaciones o simplificaciones indebidas.

Copia y pega el siguiente bloque en tu espacio de trabajo de Antigravity:

&nbsp;

\# TASK SPECIFICATION: MOBILE PIPING 3D CAD ENGINE (PLANT 3D MOBILE LITE)

&nbsp;

\#\# 1\. AGENT IDENTITY & ROLE

You are an autonomous team composed of a Principal CAD Architect, a Three.js/WebGL Graphics Engineer, and an Industrial Piping Specialist.&nbsp;

Your objective is to build a mobile-first, high-precision Web/PWA application for 3D piping routing, AutoCAD Plant 3D catalog integration, and engineering deliverables generation (Orthogonal DXF & Isometric PCF).

&nbsp;

\---

&nbsp;

\#\# 2\. CORE CONSTRAINTS & NON-NEGOTIABLE ARCHITECTURE

1\. \*\*Stack:\*\* React 19 \+ TypeScript (Strict) \+ Vite \+ Tailwind CSS.

2\. \*\*Graphics & Math Engine:\*\* Three.js directly (custom geometry buffers, raycasting, matrices). Do NOT use generic asset stores or pre-built GLTF models for standard fittings.

3\. \*\*Database Layer:\*\* In-memory SQLite via WebAssembly (\`sql.js\`) executing inside a Web Worker. Reads native \`.pspc\` and \`.pcat\` files.

4\. \*\*Data Paradigm:\*\* Topological Non-Directed Attributed Graph (Nodes \= Components, Edges \= Joints, Ports \= Polar Connection Points).

5\. \*\*Precision System:\*\* All internal vector math is executed in double-precision millimeters ($mm$). No screen-pixel-to-world-coordinate approximations.

6\. \*\*Mobile Ergonomics:\*\*

   \- Absolute ban on native mobile OS virtual keyboards (\`\<input type="text/number"\>\` inside canvas is prohibited).

   \- In-canvas custom numeric keypad (Numpad) in the bottom 30% thumb-zone.

   \- Touch targets must be \>= 44x44px with active tactile feedback via \`navigator.vibrate\`.

7\. \*\*Offline-First Resilience:\*\* Persist complete graph state, spec files, and viewport coordinates to \`IndexedDB\`.

&nbsp;

\---

&nbsp;

\#\# 3\. STRUCTURAL WORKFLOW: THE 5 EPIC PHASES

&nbsp;

Execute the codebase by progressing through these 5 phases. Do not advance to the next phase until the previous one is fully implemented, strictly typed, and verified with unit tests.

&nbsp;

\#\#\# PHASE 1: SPEC INGESTION ENGINE (\`/src/core/specs/\`)

\- Implement \`SpecDatabaseReader\` using \`sql.js\`.

\- Ingest AutoCAD Plant 3D \`.pspc\` binary buffers.

\- Parse and link SQL tables: \`EngineeringItems\`, \`PipePortProperties\`, and \`ComponentDimension\`.

\- Implement queries for:

  \- \`PIPE\`: Returns Outer Diameter (OD), Wall Thickness, Schedule.

  \- \`ELBOW\`: Returns Angle (90° or 45°), Radius ($R$), Center-to-Face ($T$), and End Types (BW, SW, THD, FLANG).

  \- \`TEE\`: Returns Center-to-Face run ($C$) and Branch ($M$).

  \- \`FLANGE\` / \`VALVE\`: Returns Face-to-Face length ($L$) and Bolt hole specs.

&nbsp;

\#\#\# PHASE 2: TOPOLOGICAL GRAPH & MATHEMATICAL ROUTING (\`/src/core/graph/\` & \`/src/core/math/\`)

\- Define strict types in \`/src/types/piping.ts\`:

  \- \`Port\`: \`{ id, componentId, position: Vector3, direction: Vector3, nominalDiameter, endType, schedule }\`.

  \- \`Component\`: \`{ id, type, specCode, catalogId, ports: Port\[\], centerline: Vector3\[\], parameters }\`.

  \- \`Joint\`: \`{ id, type, portAId, portBId, position: Vector3 }\`.

\- Implement \`calculateElbowPlacement(pStart, vertex, pNext, takeOff)\`:

  \- Calculate real physical cut points ($P\_{\\text{cut1}} \= V \- \\vec{u}\_1 \\cdot T$ and $P\_{\\text{cut2}} \= V \+ \\vec{u}\_2 \\cdot T$).

  \- Derive pipe net cut-length: $L\_{\\text{net}} \= L\_{\\text{gross}} \- T$.

  \- Construct the 4x4 orthonormal transformation matrix (TRS) via normalized basis vectors:

    \- $\\vec{X}\_{\\text{local}} \= \-\\vec{u}\_{\\text{in}}$

    \- $\\vec{Y}\_{\\text{local}} \= \\vec{u}\_{\\text{out}}$

    \- $\\vec{Z}\_{\\text{local}} \= \\vec{u}\_{\\text{in}} \\times \\vec{u}\_{\\text{out}}$

  \- Eliminate gimbal lock using Quaternions. Validate and reject tranches shorter than the fitting take-off.

&nbsp;

\#\#\# PHASE 3: PROCEDURAL 3D RUNTIME ENGINE (\`/src/viewport/geometries/\`)

\- Generate dynamic Three.js \`BufferGeometry\` on the fly:

  \- \`createPipeGeometry(od, id, length)\`: Cylindrical hollow extrusion.

  \- \`createElbowGeometry(od, id, radius, angleDeg)\`: Toroidal segment swept across the angle.

  \- \`createFlangeGeometry(od, boltCircle, thickness, hubLength)\`: Stepped cylindrical geometry.

\- Implement incremental mesh instancing: Only rebuild the active modified branch, not the entire scene graph.

&nbsp;

\#\#\# PHASE 4: MOBILE VIEWPORT & TOUCH INTERFACE (\`/src/ui/\` & \`/src/viewport/\`)

\- Implement two distinct state-driven camera modes:

  \- \`INSPECT\_MODE\`: Dual-finger Orbit, Pan, and Pinch-to-zoom.

  \- \`ROUTE\_MODE\`: Camera locked or tracking along the active routing plane (UCS).

\- Build the \*\*Touch Compass\*\*: A 3D circular screen widget exposing \+X, \-X, \+Y, \-Y, \+Z, \-Z buttons and 45° planar angle offsets.

\- Build the \*\*On-Screen Numpad\*\*: 12-key tactile pad for entering millimeters \+ quick offset buttons (+100, \+500, \+1000).

\- Implement \*\*Screen-Space Magnetic Snapping\*\*:

  \- Project open ports into 2D screen coordinates ($x, y$).

  \- Calculate screen distance to the central target reticle (Crosshair).

  \- If distance \< 35px: trigger \`navigator.vibrate(15)\`, highlight port with a bounding sphere, and snap vector origin to port position.

\- Collision Detection: Flag spatial collisions between non-connected pipes in red.

&nbsp;

\#\#\# PHASE 5: DRAFTING & DELIVERABLES EXPORTERS (\`/src/core/exporters/\`)

\- \*\*PCF Exporter (Isometric data):\*\*

  \- Serialize the graph into a standard Piping Component File (Alias/Isogen standard).

  \- Include headers, global units (MM), line IDs, and blocks: \`PIPE\`, \`ELBOW\`, \`TEE\`, \`FLANGE\`.

  \- Export precise End-Point 1, End-Point 2 coordinates, diameters, wall thicknesses, and connection types.

\- \*\*2D Orthogonal DXF Exporter:\*\*

  \- Project 3D centerline and bounding profiles to 2D Top (XY), Front (XZ), and Side (YZ) planes.

  \- Integrate \`dxf-writer\` to emit layers: \`CENTERLINE\`, \`PIPING\_CONTOUR\`, and \`DIMENSIONS\`.

  \- Draw extension lines and aligned dimension labels between node vertices.

&nbsp;

\---

&nbsp;

\#\# 4\. DEFINITION OF DONE (DOD) & VALIDATION GATES

Before declaring any phase complete:

1\. \*\*Typing & Linting:\*\* \`tsc \--noEmit\` must pass with zero errors under \`"strict": true\`.

2\. \*\*Unit Tests (Vitest):\*\*

   \- Verify that intersecting a 1000mm run on \+X turning to \+Y with a 76.2mm take-off codo results in a pipe cut-length of exactly 923.8mm.

   \- Verify that the elbow's transformation matrix produces exact orthonormal basis vectors ($|\\vec{X}| \= |\\vec{Y}| \= |\\vec{Z}| \= 1$ and dot products $= 0$).

3\. \*\*Performance:\*\* The Three.js canvas must maintain 60 FPS on mid-range mobile viewports during continuous routing.

&nbsp;

\---

&nbsp;

\#\# 5\. IMMEDIATE FIRST ACTION

Begin immediately with \*\*PHASE 1 & PHASE 2\*\*:

1\. Create \`/src/types/piping.ts\` with all core graph interfaces.

2\. Implement \`/src/core/specs/SpecDatabaseReader.ts\` capable of loading \`.pspc\` files via \`sql.js\`.

3\. Implement \`/src/core/math/elbowSolver.ts\` with complete vector math and test suites.

Provide the code and corresponding unit tests now.

&nbsp;

Cómo monitorear la ejecución del agente

Cuando el agente responda: Revisará los archivos generados y correrá los tests unitarios. Verificá que la matemática del elbowSolver no use ángulos de Euler simples (rotation.set(x, y, z)), sino la base ortonormal con matrices o cuaterniones que exige el prompt.

Para avanzar de fase: Una vez que el agente te entregue la Fase 1 y 2 funcionando con sus tests, indícale:

"Fases 1 y 2 aprobadas. Procedé de forma idéntica con la Fase 3 (Geometrías paramétricas) y la Fase 4 (Viewport táctil y Numpad)".

&nbsp;

hay 4 directivas críticas de "blindaje" que debés tener bajo la manga. Los agentes de IA suelen fallar en los detalles de ingeniería mecánica real y en la memoria del navegador móvil.

Sumale estas instrucciones específicas cuando veas que el agente empieza a escribir código:

1\. El "Anti-Truco" de los Diámetros (Nominal vs. Real)

Los modelos de lenguaje confunden constantemente el diámetro nominal (ND) con el exterior (OD). Si le pedís un caño de 2", un programador novato o un agente descuidado suele modelar un cilindro de radio 25 o 50 mm.

Directiva a sumar:

"Bajo ninguna circunstancia uses el Diámetro Nominal (ND) para el radio de las geometrías 3D. El motor gráfico debe alimentarse estrictamente del OuterDiameter (OD) y WallThickness extraídos de la tabla PipePortProperties del .pspc (ejemplo: ND 2" \\rightarrow OD 60.3 mm, Schedule 40 \\rightarrow espesor 3.91 mm)."

2\. Gestión de memoria en navegadores móviles (Evitar Crashes de WebGL)

En teléfonos, abrir una pestaña con Three.js que crea geometrías continuas satura la GPU en 5 minutos y reinicia la página sin aviso (WebGL Context Lost).

Directiva a sumar:

"Implementá un recolector de basura de geometrías explícito. Cada vez que se elimine, corte o edite un tramo de caño o un accesorio, el sistema debe ejecutar obligatoriamente geometry.dispose() y material.dispose(). Si el contexto WebGL se pierde (webglcontextlost), la app debe restaurar la escena automáticamente desde el estado serializado en Zustand/IndexedDB."

3\. La regla de la "Gravedad Hidráulica" (Dirección del Compás)

En cañerías industriales, el eje vertical suele ser \+Z, mientras que Three.js usa por defecto \+Y como altura (Y-up). Si no lo aclarás, todos los planos de planta y alzados quedarán volcados 90°.

Directiva a sumar:

"Configurá la escena de Three.js con orientación industrial estándar: Z-Up (Object3D.DEFAULT\_UP.set(0, 0, 1)). El eje Z representa elevación física (altura/cota de cañería), el eje X representa Este-Oeste y el eje Y representa Norte-Sur."

4\. Tolerancias y validaciones de fabricación (Piping Rules)

Para evitar que la app permita modelar cosas imposibles de fabricar:

Directiva a sumar:

\*"Añadí un validador de reglas de cañerías en tiempo de ruteo:

Longitud mínima de niple: No permitir tramos rectos menores a 50 mm o 2 veces el diámetro exterior (lo que sea mayor).

Soldaduras consecutivas: No permitir conectar dos accesorios directamente (ejemplo: codo contra codo) sin intercalar un niple de soldadura o verificar si la especificación admite un fitting 'Male-Female'."\*

Cómo gestionar al agente durante el proceso

Si el agente escribe demasiado texto y poco código: Escribile: "Menos explicaciones conceptuales. Mostrame la implementación en TypeScript con el código completo y sin placeholders (// TODO)".

Si te propone usar librerías externas pesadas: Frenalo: "Mantén el bundle ligero. No agregues librerías de UI complejas (como MUI o AntD). Usa Tailwind CSS nativo para mantener la PWA por debajo de los 2 MB de carga inicial".

&nbsp;

Para cerrar y que no se te escape ningún punto ciego en la ejecución real con los agentes, quedan tres detalles críticos finales:

1\. El problema del "Touch Target" y el Bloqueo de Gestos Nativos

En móviles, si arrastrás el dedo dentro de un canvas WebGL sin configuración previa, el navegador interpreta el gesto como "Pull-to-refresh" (recargar página) o zoom del sistema.

Directiva a sumar:

"Configurá en el contenedor principal de React y en el elemento \<canvas\> la propiedad CSS touch-action: none; y bloqueá el comportamiento por defecto de eventos pointerdown y touchmove. El viewport debe capturar el 100% de los gestos sin activar recargas accidentales de página ni zoom nativo del navegador."

2\. Gestión de Reducciones Automáticas (Cambio de Diámetro en Vivo)

¿Qué pasa si el operador viene ruteando en 4" y de pronto selecciona 2" en el panel? El agente suele colgarse o romper la conexión si no tiene esta regla:

Directiva a sumar:

\*"Si el usuario cambia el Diámetro Nominal (ND) durante el ruteo de un tramo continuo:

Detener el tramo actual.

Consultar en la spec (.pspc) una reducción concéntrica (REDUCER CONCENTRIC) compatible con ambos diámetros.

Insertar la reducción descontando su largo cara a cara (L).

Continuar el ruteo desde el puerto secundario con el nuevo diámetro."\*

3\. Mecanismo de Recuperación (Undo / Redo Transaccional)

En pantallas táctiles los toques involuntarios son constantes. Un botón de "Deshacer" no puede ser solo volver la cámara atrás; debe revertir la mutación del grafo.

Directiva a sumar:

"Implementá un historial de comandos transaccionales (Command Pattern) en Zustand. Cada acción destructiva o constructiva (addPipe, splitWithTee, insertFitting) debe ser un objeto con dos métodos: execute() y undo(). Tocar el botón de deshacer debe restaurar la topología del grafo y las longitudes netas al estado previo exacto."

Plan de acción para empezar

Creá el repositorio o espacio de trabajo en Antigravity.

Pegá el Prompt Maestro Definitivo que vimos antes.

Sumale estos 4 o 5 puntos de blindaje en cuanto empiece a codificar.

Cuando termine el primer bloque, exigile los tests con: "Ejecutá npm run test y mostrame el reporte de cobertura de la matemática de corte". Con eso asegurás una base técnica sólida desde el minuto uno.

&nbsp;

En Antigravity, la mejor práctica es darle un Contexto Maestro (System Prompt / Workspace Rules) y después ejecutar Prompts de Tarea (Sprints) uno por uno.

Paso 1: Configurar el Contexto de Proyecto (System Prompt)

Pegá esto en el archivo de instrucciones base del proyecto o en el chat inicial para fijar las reglas del juego:

&nbsp;

ACT AS: Principal 3D CAD Software Architect & Mechanical Piping Specialist.

&nbsp;

PROJECT CORE:

We are building a mobile-first 3D piping CAD application (inspired by AutoCAD Plant 3D).

The application runs in modern mobile web browsers (PWA/WebGL).

&nbsp;

STRICT ARCHITECTURAL CONSTRAINTS:

1\. Framework: React 19 \+ TypeScript (Strict) \+ Vite.

2\. 3D Graphics: Three.js (raw math & geometry buffers) / @react-three/fiber.

3\. Database: In-memory SQLite via WebAssembly (sql.js) inside a Web Worker.

4\. Core Logic: Must use a Non-Directed Graph data structure (Nodes \= Components, Edges \= Joints, Anchors \= Ports).

5\. Math Convention: Double precision millimeter units (mm). Never use screen pixels for 3D world positioning.

6\. Mobile UX: Never summon native virtual OS keyboards. Use custom in-canvas numpads and compass gizmos.

&nbsp;

WORKING PROTOCOL:

\- Do NOT generate full-app boilerplate in a single turn.

\- Work strictly in modular sprints as requested.

\- Prioritize clean mathematical logic and data structures before complex UI/styling.

Paso 2: Ejecutar los Sprints (Prompts de Tarea Secuenciales)

No le pidas todo junto. Andá enviando cada prompt cuando el agente termine de implementar y testear el anterior.

Sprint 1: Lector de Catálogos (.pspc en SQLite)

Prompt para el agente:

"Implementá el módulo de base de datos en /src/core/specs/SpecReader.ts usando sql.js. Necesito una clase que reciba un ArrayBuffer de un archivo .pspc de AutoCAD Plant 3D y me permita consultar fittings. Creá el método findFitting(criteria) que cruce las tablas EngineeringItems, PipePortProperties y ComponentDimension para extraer: PnPID, OuterDiameter, EndType, Schedule, y calcule el takeOff (distancia centro a cara) para codos de 90° y 45°. Incluí tests unitarios con Vitest simulando una base de datos SQLite en memoria."

Sprint 2: Modelo de Grafo y Topología

Prompt para el agente:

"Diseñá la estructura de datos topológica en /src/core/graph/. Creá las interfaces TypeScript para Port, Component (Pipe, Elbow, Tee) y Joint. Implementá la clase PipingGraph con la lógica para conectar puertos mediante vectores normales opuestos (V\_1 \\cdot V\_2 \= \-1). Ningún componente puede flotar en el espacio; todos deben registrarse en el grafo mediante sus puertos."

Sprint 3: Matemática de Recorte y Posicionamiento 3D

Prompt para el agente:

\*"Implementá la función matemática calculateElbowPlacement en /src/core/math/elbowSolver.ts usando Three.js (Vector3, Matrix4, Quaternion). Dados: un punto inicial P\_1, un vértice de intersección V, un punto objetivo P\_2, y el valor de takeOff:

Calculá los puntos de corte reales de la cañería entrante y saliente (P\_{\\text{cut1}} y P\_{\\text{cut2}}).

Calculá la longitud neta de corte de la cañería.

Construí la matriz de transformación 4x4 ortonormal (TRS) para rotar y posicionar la malla paramétrica del codo en el vértice sin usar Euler angles ni sufrir gimbal lock."\*

Sprint 4: Generación Procedural de Geometría (Sin archivos externos)

Prompt para el agente:

\*"Creá un generador de geometría paramétrica en Three.js en /src/viewport/geometries/. Necesito dos generadores de BufferGeometry:

createPipeGeometry(outerDiameter, wallThickness, length): Un cilindro hueco tubular.

createElbowGeometry(outerDiameter, radius, angleDeg, segments): Un toroide extruido en arco que coincida con el ángulo de giro y el radio del codo.

Las geometrías deben instanciarse directamente en memoria sin depender de modelos GLTF/OBJ."\*

Sprint 5: Interfaz Táctil Móvil y Viewport

Prompt para el agente:

\*"Montá el canvas de Three.js con soporte táctil en /src/viewport/CanvasViewer.tsx. Separá la interacción en dos modos mediante Zustand: InspectMode (OrbitControls con 2 dedos) y RouteMode (cámara bloqueada). Creá los siguientes componentes en React \+ Tailwind:

Un compás táctil 3D flotante con 6 ejes ortogonales (+X, \-X, \+Y, \-Y, \+Z, \-Z) y accesos a 45°.

Un teclado numérico táctil (Numpad) en el tercio inferior de la pantalla para ingresar distancias en milímetros, sin activar el teclado virtual del celular.

Un raycaster con snapping magnético que resalte los puertos disponibles cuando la retícula central pase a menos de 30px."\*

Sprint 6: Exportador PCF (Planos Isométricos)

Prompt para el agente:

"Implementá el exportador a formato estándar PCF (Piping Component File) en /src/core/exporters/PcfExporter.ts. El método debe recorrer el PipingGraph y generar un archivo de texto plano con los bloques estándar PIPE, ELBOW, con sus coordenadas de puntos extremos (End-Points), diámetros, espesores y componentes de conexión asociados, listo para ser consumido por motores como Isogen."

La Regla de Oro al interactuar con el Agente

Cuando el agente te devuelva código o proponga cambios:

No aceptes soluciones genéricas: Si te propone "cargar modelos .GLTF de una librería comercial", frenalo y decile: "No. Las piezas deben generarse paramétricamente con el diámetro exterior y espesor que arroja la base de datos .pspc".

Pedí validación visual o tests: Cada vez que termine un sprint, exigile: "Mostrame el test unitario pasando o generá una escena mínima en Storybook / Canvas de prueba donde se renderice el resultado".

&nbsp;

Lo que te falta agregar a las directivas de los agentes

Manejo de interferencias y pendientes: Decile: "Si dos caños se cruzan en el espacio, no permitas la colisión silenciosa; marcá la intersección en rojo. Añadí soporte para pendiente hidráulica mínima (ej. 1% o 2% en drenajes) mediante un modificador en el eje Z".

El módulo de Planos Ortogonales (Planta y Alzados): Decile: "Para generar planos 2D ortogonales, no hagas capturas de pantalla. Proyectá las aristas del modelo 3D sobre los planos XY (Planta) y XZ/YZ (Cortes/Vistas) usando matrices ortográficas, generá cotas de eje a eje y exportá directamente a DXF mediante la librería makerjs o dxf-writer".

Persistencia local (Offline-first): Decile: "La app se usa en planta industrial sin internet. Guardá el estado completo del grafo y la spec activa en IndexedDB para que el operador no pierda la sesión al cerrar la pestaña o el navegador móvil".

Criterio de Aceptación Estricto (Definition of Done): Exigile: "No des por terminado ningún sprint hasta que el código compile sin errores de TypeScript (tsc \--noEmit), pase las pruebas unitarias de cálculo vectorial y corra a 60 FPS estables en un emulador móvil de Chrome".

&nbsp;

\# TASK DIRECTIVE: Mobile Piping 3D CAD Engine (Plant 3D Lite)

&nbsp;

\#\# 1\. PROJECT OBJECTIVE

Develop a mobile-first, high-precision Web/PWA application for 3D piping routing, catalog ingestion, and isometric data extraction, inspired by AutoCAD Plant 3D workflows. The system must allow users to route pipes with millimeter precision using touch controls, enforce piping specs from SQLite files, and export standardized engineering files.

&nbsp;

\---

&nbsp;

\#\# 2\. TECHNOLOGY STACK

\- \*\*Core Framework:\*\* React 19 \+ Vite \+ TypeScript (Strict Mode).

\- \*\*Styling & UI:\*\* Tailwind CSS (mobile-first ergonomics, compact touch targets \>= 44x44px, backdrop blur drawers).

\- \*\*3D Graphics Engine:\*\* Three.js / @react-three/fiber with custom procedural geometry buffers (do not use generic asset packs).

\- \*\*Data Layer:\*\* \`sql.js\` (WebAssembly SQLite) for client-side catalog (.pspc/.pcat) parsing in Web Workers.

\- \*\*State Management:\*\* Zustand (reactive graph store separated from the 60fps render loop).

\- \*\*Vector & Drafting Export:\*\* \`makerjs\` or \`dxf-writer\` for orthogonal DXF layouts; plain text generators for standard PCF (Piping Component File).

&nbsp;

\---

&nbsp;

\#\# 3\. MODULAR ARCHITECTURE

&nbsp;

Implement the project in 4 isolated, testable modules:

&nbsp;

\#\#\# Module A: Spec & Catalog Ingestion Engine (\`/src/core/specs/\`)

\- Load and parse AutoCAD Plant 3D \`.pspc\` and \`.pcat\` files using \`sql.js\`.

\- Extract tables: \`EngineeringItems\`, \`PipePortProperties\`, \`ComponentDimensions\`, and connection compatibility rules.

\- Map records to a clean internal schema: Nominal Diameter (ND), Schedule, Outer Diameter (OD), Wall Thickness, End Types (BW, SW, THD, FLANG), and Center-to-Face dimensions.

&nbsp;

\#\#\# Module B: Topological Network Graph (\`/src/core/graph/\`)

\- Maintain a non-directed attributed graph of piping components:

  \- \*\*Nodes:\*\* Components (Pipes, Elbows, Tees, Flanges, Valves).

  \- \*\*Ports:\*\* Exact 3D point (\`Vector3\`), normal alignment vector (\`Vector3\`), ND, and connection type.

  \- \*\*Joints:\*\* Logical and physical connections (welds, gaskets, threaded joints).

\- Implement routing math:

  \- Vector direction tracking ($X, Y, Z$ orthogonal and 45° constraints).

  \- Real-time cut-length calculation with fitting take-off subtraction.

  \- Automatic fitting resolution: inserting 90°/45° elbows when routing vectors change direction, and inserting tees when tapping existing pipe walls.

&nbsp;

\#\#\# Module C: Mobile-Optimized 3D Viewport & Touch UX (\`/src/viewport/\`)

\- Canvas viewport with fixed status bar and a bottom contextual sliding drawer (thumb-zone optimized).

\- \*\*Input modes:\*\* Explicit split between \`Inspect Mode\` (Orbit, Pan, Zoom) and \`Routing Mode\`.

\- \*\*In-Canvas Virtual Numpad:\*\* Custom numeric input for lengths in mm (NEVER trigger the native mobile OS soft keyboard).

\- \*\*Directional Compass Gizmo:\*\* 3D touch compass providing 6 orthogonal axis directions and 45° planar vectors.

\- \*\*Screen-Space Magnetic Snapping:\*\* Raycast and project port coordinates to screen space; highlight and vibrate (\`navigator.vibrate\`) when the touch crosshair enters a 360-degree snap radius.

&nbsp;

\#\#\# Module D: Drafting & Deliverables Exporter (\`/src/core/exporters/\`)

\- \*\*PCF Exporter:\*\* Generate valid Alias/Isogen compatible Piping Component Files with component attributes, coordinates, cut lengths, and weld point indices.

\- \*\*2D Orthogonal View Generator:\*\* Compute 2D projections (Top, Front, Side) of the 3D network with basic Hidden Line Removal (HLR) and dimension lines exported to standard DXF.

&nbsp;

\---

&nbsp;

\#\# 4\. STRICT CONSTRAINTS & CODING RULES

1\. \*\*Performance First:\*\* No heavy computations inside the Three.js \`useFrame\` loop. The network topology graph must update on discrete actions and rebuild meshes incrementally.

2\. \*\*Precision:\*\* All geometric calculations must be executed in millimeters ($mm$) with double precision floating-point arithmetic.

3\. \*\*No Native Inputs:\*\* Do not use \`\<input type="number"\>\` or \`\<input type="text"\>\` inside the 3D viewport canvas. All inputs must use the custom on-screen numeric keypad.

4\. \*\*Code Quality:\*\* All types must be strictly defined in \`/src/types/piping.ts\`. Avoid \`any\`. Provide unit tests (\`vitest\`) for all vector math and fitting insertion logic.

&nbsp;

\---

&nbsp;

\#\# 5\. FIRST EXECUTION STEP

Begin with \*\*Module A & B\*\*:

1\. Define the TypeScript interfaces in \`/src/types/piping.ts\` for Components, Ports, Joints, and Specs.

2\. Implement the \`PipingGraph\` class with methods: \`addPipe()\`, \`insertFittingAtVector()\`, and \`calculateTakeOff()\`.

3\. Provide a test harness showing a 2" pipe segment running along \+X, making a 90° turn along \+Y, and automatically inserting the correct elbow while reducing the pipe cut lengths.

&nbsp;