import * as THREE from 'three';
import { Port } from '../../types/piping';

export interface SnapResult {
  isSnapped: boolean;
  snappedPort: Port | null;
  screenDistancePx: number;
  screenPosition: { x: number; y: number };
}

let lastVibratedPortId: string | null = null;

/**
 * Proyecta los puertos abiertos a coordenadas de pantalla (2D en píxeles) y calcula
 * la distancia euclídea a la retícula central (Crosshair).
 * Si la distancia es menor a snapThresholdPx (35px), activa vibración háptica
 * y retorna el puerto anclado.
 *
 * @param ports Lista de puertos abiertos a evaluar
 * @param camera Cámara Three.js activa
 * @param screenWidth Ancho del viewport en píxeles
 * @param screenHeight Alto del viewport en píxeles
 * @param snapThresholdPx Umbral de distancia de atracción en píxeles (por defecto 35px)
 */
export function findScreenMagneticSnap(
  ports: Port[],
  camera: THREE.Camera,
  screenWidth: number,
  screenHeight: number,
  snapThresholdPx: number = 35
): SnapResult {
  const centerScreenX = screenWidth / 2;
  const centerScreenY = screenHeight / 2;

  let closestPort: Port | null = null;
  let minDistance = Infinity;
  let closestScreenPos = { x: 0, y: 0 };

  const tempVec = new THREE.Vector3();

  for (const port of ports) {
    tempVec.copy(port.position).project(camera);

    // Si el punto está detrás del plano de recorte cercano de la cámara, descartar
    if (tempVec.z > 1.0) continue;

    // Conversión de coordenadas NDC [-1, 1] a píxeles de pantalla
    const screenX = ((tempVec.x + 1) / 2) * screenWidth;
    const screenY = ((-tempVec.y + 1) / 2) * screenHeight;

    const dx = screenX - centerScreenX;
    const dy = screenY - centerScreenY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < minDistance) {
      minDistance = dist;
      closestPort = port;
      closestScreenPos = { x: screenX, y: screenY };
    }
  }

  const isSnapped = minDistance <= snapThresholdPx && closestPort !== null;

  // Retroalimentación háptica táctil móvil (navigator.vibrate)
  if (isSnapped && closestPort) {
    if (lastVibratedPortId !== closestPort.id) {
      lastVibratedPortId = closestPort.id;
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try {
          navigator.vibrate(15);
        } catch {
          // Ignorar si el navegador bloquea vibración no iniciada por usuario
        }
      }
    }
  } else {
    lastVibratedPortId = null;
  }

  return {
    isSnapped,
    snappedPort: isSnapped ? closestPort : null,
    screenDistancePx: minDistance,
    screenPosition: closestScreenPos
  };
}
