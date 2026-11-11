// Adaptadores: dónde se dibujan las piezas y con qué cámara.
//
// - pagina():           2D. Un lienzo fijo sobre toda la ventana; 1 unidad = 1 píxel CSS.
// - modelViewer(mv, …): 3D sobre un <model-viewer>. Lienzo propio encima del visor, con la cámara
//                       copiada cuadro a cuadro de la suya.
// - three({…}):         3D dentro de una escena three.js propia. Las piezas se agregan a esa escena
//                       y se dibujan con el renderer y el bucle de la página.
//
// Interfaz que usa el motor:
//   modo, escena, camara, propio (true si el motor dibuja), dibujar(), sincronizar() → cambió,
//   proyectar(Vector3) → {x, y} en píxeles de la ventana, desdePantalla(x, y) (solo 2D),
//   entrar(info), durante(q), salir(), volver()
// El motor les pone alPerder / alRecuperar: avisan si el navegador pierde el contexto WebGL.
import * as THREE from 'three';

function crearRenderer(lienzo) {
  const renderer = new THREE.WebGLRenderer({ canvas: lienzo, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  return renderer;
}

// Aviso de contexto WebGL perdido (pasa en teléfonos con poca memoria): three.js lo recupera solo,
// pero mientras tanto el lienzo queda en blanco. Devuelve la función que quita los avisos.
function vigilarContexto(lienzo, ad) {
  const perder = () => ad.alPerder?.();
  const recuperar = () => ad.alRecuperar?.();
  lienzo.addEventListener('webglcontextlost', perder);
  lienzo.addEventListener('webglcontextrestored', recuperar);
  return () => {
    lienzo.removeEventListener('webglcontextlost', perder);
    lienzo.removeEventListener('webglcontextrestored', recuperar);
  };
}

const easeInOut = (t) => { t = Math.min(Math.max(t, 0), 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };

export const Adaptadores = {
  // 2D: toda la ventana. Si no se pasa lienzo, se crea uno fijo, transparente y sin eventos.
  pagina({ lienzo } = {}) {
    const propioLienzo = !lienzo;
    if (!lienzo) {
      lienzo = document.createElement('canvas');
      Object.assign(lienzo.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: '2147483000' });
      lienzo.setAttribute('aria-hidden', 'true');
      document.body.appendChild(lienzo);
    }
    const renderer = crearRenderer(lienzo);
    const escena = new THREE.Scene();
    const camara = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 5000);
    camara.position.z = 1000;
    let w = 0, h = 0;
    const ajustar = () => {
      w = innerWidth; h = innerHeight;
      renderer.setSize(w, h, false);
      Object.assign(camara, { left: -w / 2, right: w / 2, top: h / 2, bottom: -h / 2 });
      camara.updateProjectionMatrix();
      return true;
    };
    ajustar();
    let sucio = false;
    const alAjustar = () => { sucio = ajustar(); };
    addEventListener('resize', alAjustar);
    let soltar = () => {};
    const ad = {
      modo: '2d', propio: true, escena, camara, renderer, lienzo,
      desdePantalla: (x, y) => new THREE.Vector3(x - w / 2, h / 2 - y, 0),
      proyectar: (p) => ({ x: p.x + w / 2, y: h / 2 - p.y }),
      sincronizar() { const s = sucio; sucio = false; return s; },
      dibujar: () => renderer.render(escena, camara),
      entrar() {}, durante() {}, salir() {}, volver() {},
      destruir() {
        removeEventListener('resize', alAjustar);
        soltar();
        renderer.dispose();
        if (propioLienzo) lienzo.remove();
      },
    };
    soltar = vigilarContexto(lienzo, ad);
    return ad;
  },

  // 3D sobre <model-viewer>. `lienzo` debe cubrir exactamente al visor (position:absolute; inset:0;
  // pointer-events:none) y estar encima de él. camara: 'auto' (vista cenital si el destino va en
  // el piso), 'cenital' o 'quieta'. reserva: píxeles que deben quedar libres arriba y abajo del
  // destino en vista cenital (para una leyenda o botones encima del lienzo).
  modelViewer(mv, { lienzo, camara: modoCamara = 'auto', reserva = 0 } = {}) {
    if (!lienzo) throw new Error('Adaptadores.modelViewer necesita { lienzo } encima del visor');
    const renderer = crearRenderer(lienzo);
    const escena = new THREE.Scene();
    const camara = new THREE.PerspectiveCamera(30, 1, 0.01, 200);
    let ultima = '', guardado = null, vista = null, reanudar = false, piso = null, ultimoQ = 0;
    let soltar = () => {};
    // Vista cenital que deja el plano del piso entero dentro del lienzo, sea alto o ancho.
    const encuadrar = () => {
      const { lado, centroY, pisoY } = piso;
      const tan = Math.tan(THREE.MathUtils.degToRad(30 / 2));
      const aspecto = camara.aspect || 1;
      const alto = Math.max(0.4, Math.min(0.86, 1 - (2 * reserva) / (lienzo.clientHeight || 1)));
      const alPiso = Math.max(lado / 2 / (tan * alto), lado / 2 / (tan * aspecto * 0.9));
      vista = { theta: 0, phi: 0.0001, radius: alPiso - (centroY - pisoY), fov: 30 };
      // Solo mientras dura: model-viewer calcula su plano de recorte con la distancia máxima,
      // y dejarla enorme siempre recorta la parte delantera de los modelos.
      mv.minCameraOrbit = 'auto 0deg 0m';
      mv.maxCameraOrbit = `auto 180deg ${(Math.max(vista.radius, guardado.orbita.radius) * 1.15).toFixed(3)}m`;
    };
    const mover = (q) => {
      ultimoQ = q;
      if (!vista || !guardado) return;
      const a = guardado.orbita, b = vista, e = easeInOut((q - 0.12) / 0.78);
      mv.cameraOrbit = `${a.theta + (b.theta - a.theta) * e}rad ${a.phi + (b.phi - a.phi) * e}rad ${a.radius + (b.radius - a.radius) * e}m`;
      mv.fieldOfView = `${a.fov + (b.fov - a.fov) * e}deg`;
      mv.jumpCameraToGoal();
    };
    const ajustar = () => {
      const w = lienzo.clientWidth, h = lienzo.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camara.aspect = w / h;
      ultima = '';
      // Si la ventana cambia con el destino a la vista (teléfono girado), se vuelve a encuadrar.
      if (vista && piso && guardado) { encuadrar(); mover(ultimoQ); }
    };
    const observador = new ResizeObserver(ajustar);
    observador.observe(lienzo);
    ajustar();

    const pausar = () => { if (!mv.paused) { mv.pause(); reanudar = true; } };

    const ad = {
      modo: '3d', propio: true, escena, camara, renderer, lienzo, mv,
      sincronizar() {
        const o = mv.getCameraOrbit(), t = mv.getCameraTarget(), fov = mv.getFieldOfView();
        const clave = `${o.theta.toFixed(5)}|${o.phi.toFixed(5)}|${o.radius.toFixed(4)}|${fov.toFixed(3)}|${camara.aspect}`;
        if (clave === ultima) return false;
        ultima = clave;
        const sp = Math.sin(o.phi);
        camara.fov = fov;
        camara.position.set(t.x + o.radius * sp * Math.sin(o.theta), t.y + o.radius * Math.cos(o.phi), t.z + o.radius * sp * Math.cos(o.theta));
        camara.up.set(0, 1, 0);
        camara.near = Math.max(o.radius / 200, 0.005);
        camara.far = o.radius * 50 + 10;
        camara.lookAt(t.x, t.y, t.z);
        camara.updateProjectionMatrix();
        camara.updateMatrixWorld();
        return true;
      },
      proyectar(p) {
        const r = lienzo.getBoundingClientRect();
        const v = p.clone().project(camara);
        return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
      },
      dibujar: () => renderer.render(escena, camara),

      // Antes de transformarse: congela la animación y el giro, y prepara la cámara.
      // info.piso: { lado, centroY, pisoY } si el destino va en el piso.
      entrar(info) {
        pausar();
        const o = mv.getCameraOrbit();
        // Si ya había entrado (clics rápidos), se conserva lo guardado: es el estado original.
        if (!guardado) guardado = {
          orbita: { theta: Math.atan2(Math.sin(o.theta), Math.cos(o.theta)), phi: o.phi, radius: o.radius, fov: mv.getFieldOfView() },
          autoRotate: mv.autoRotate, controles: mv.cameraControls,
          min: mv.minCameraOrbit, max: mv.maxCameraOrbit,
        };
        mv.autoRotate = false;
        mv.cameraControls = false;
        vista = null;
        piso = null;
        ultimoQ = 0;
        const cenital = modoCamara === 'cenital' || (modoCamara === 'auto' && info?.piso);
        if (cenital && info?.piso) { piso = info.piso; encuadrar(); }
      },
      volver() { pausar(); },
      durante: mover,
      // De vuelta en el origen: todo como estaba.
      salir() {
        if (guardado) {
          mv.cameraOrbit = `${guardado.orbita.theta}rad ${guardado.orbita.phi}rad ${guardado.orbita.radius}m`;
          mv.fieldOfView = `${guardado.orbita.fov}deg`;
          mv.jumpCameraToGoal();
          mv.minCameraOrbit = guardado.min;
          mv.maxCameraOrbit = guardado.max;
          mv.cameraControls = guardado.controles;
          mv.autoRotate = guardado.autoRotate;
          guardado = null;
        }
        vista = null;
        piso = null;
        if (reanudar) { reanudar = false; mv.play(); }
      },
      destruir() { observador.disconnect(); soltar(); renderer.dispose(); },
    };
    soltar = vigilarContexto(lienzo, ad);
    return ad;
  },

  // 3D en una escena three.js propia: las piezas se agregan a `escena` y se dibujan con tu bucle.
  // alPausar / alReanudar: para congelar tus animaciones mientras dura la transformación.
  three({ escena, camara, renderer, alPausar = () => {}, alReanudar = () => {} }) {
    let soltar = () => {};
    const ad = {
      modo: '3d', propio: false, escena, camara, renderer, lienzo: renderer.domElement,
      sincronizar: () => false,
      proyectar(p) {
        const r = renderer.domElement.getBoundingClientRect();
        const v = p.clone().project(camara);
        return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
      },
      dibujar() {},
      entrar: () => alPausar(), volver: () => alPausar(), durante() {}, salir: () => alReanudar(),
      destruir() { soltar(); },
    };
    soltar = vigilarContexto(renderer.domElement, ad);
    return ad;
  },
};
