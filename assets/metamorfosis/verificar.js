// Verificación automática: lee el código QR que quedó dibujado en un lienzo (WebGL con
// preserveDrawingBuffer, como el del motor). Devuelve el texto o null si no se puede leer.
//
// Primero prueba con el lector del propio navegador (BarcodeDetector: Android, macOS), que no
// descarga nada; si no existe o no encuentra el código, usa jsQR (desde jsDelivr). Si jsQR no se
// puede descargar, la promesa falla: «no se pudo comprobar» no es lo mismo que «no se lee».
export async function leerQR(lienzo, { fondo = '#000', lado = 720 } = {}) {
  // Una copia reducida basta para leerlo y es mucho más rápida en un teléfono (lienzo a 2x o 3x).
  const escala = Math.min(1, lado / Math.max(lienzo.width, lienzo.height, 1));
  const copia = document.createElement('canvas');
  copia.width = Math.max(1, Math.round(lienzo.width * escala));
  copia.height = Math.max(1, Math.round(lienzo.height * escala));
  const ctx = copia.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = fondo;
  ctx.fillRect(0, 0, copia.width, copia.height);
  ctx.drawImage(lienzo, 0, 0, copia.width, copia.height);

  if ('BarcodeDetector' in globalThis) {
    try {
      const encontrados = await new globalThis.BarcodeDetector({ formats: ['qr_code'] }).detect(copia);
      if (encontrados.length) return encontrados[0].rawValue;
    } catch { /* sin lector nativo utilizable: sigue con jsQR */ }
  }
  const modulo = await import('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/+esm');
  const jsQR = modulo.default ?? modulo.jsQR;
  const d = ctx.getImageData(0, 0, copia.width, copia.height);
  return jsQR(d.data, d.width, d.height)?.data ?? null;
}
