// Vitrina: un modelo a la vez, con su botón de AR, su historia narrada y una tira de miniaturas.
import { MODELOS, GRUPOS, IDIOMAS, urlDe, usdzDe, esIOS, esAndroid, enAppExterna, enlaceChrome } from './modelos.js?v=20261111e';
import { soportaQuickLook, precargar, abrirQuickLook } from './quicklook.js?v=20261111e';
import { qrSvg } from './qr.js?v=20261111e';

const $ = (id) => document.getElementById(id);
const mv = $('mv');
const escenario = mv.closest('.escenario');
const params = new URLSearchParams(location.search);
const esEscritorio = !esIOS && !esAndroid && matchMedia('(hover: hover) and (pointer: fine)').matches;
const conQuickLook = esIOS && soportaQuickLook();
const enChromeAndroid = esAndroid && /Chrome\//.test(navigator.userAgent) &&
  !/SamsungBrowser|EdgA|OPR|wv\)|FBAN|FBAV|Instagram/.test(navigator.userAgent);
const ahorroDatos = Boolean(navigator.connection?.saveData);

let indice = Math.max(0, MODELOS.findIndex((m) => m.id === params.get('m')));
let modelo = MODELOS[indice];
let idioma = idiomaInicial();
let audio = null; // estado de sonido del modelo actual

/* ---------------------------------------------------------------- QR escondido en el modelo */
// El botón QR descompone el modelo en cubos de sus colores que forman su código QR, y vuelve.
// Lo hace el motor de la skill «metamorfosis» (assets/metamorfosis/): muestrea el modelo tal
// como se ve, congela su animación, sube la cámara a vista cenital solo mientras dura el QR y
// deja el QR con la paleta del modelo, legible (corrección H, contraste OKLab).
// El motor (y three.js) se descarga solo cuando hace falta: la página y la AR no dependen de él.
let suelo = null;  // instancia de Metamorfosis (tiene su propio contexto WebGL)
let motor = null;  // promesa del módulo del motor
function cargarMotor() {
  if (!motor) {
    motor = import('./metamorfosis/metamorfosis.js?v=20261111e');
    motor.catch(() => { motor = null; }); // si la descarga falló, el próximo intento vuelve a probar
  }
  return motor;
}
// El efecto se arma en el primer toque al QR (en el computador, desde que carga el modelo): su
// lienzo 3D ocupa memoria gráfica que en el celular le hace falta a la AR.
function crearSuelo(m) {
  if (suelo) return suelo;
  const efecto = new m.Metamorfosis({ adaptador: m.Adaptadores.modelViewer(mv, { lienzo: $('lienzoQr'), reserva: 64 }) });
  // reserva: la leyenda «Escanéalo…» va sobre el lienzo y no debe tapar el código.
  efecto.alCambiar = pintarEnQr;
  // Si el teléfono se queda sin memoria gráfica con el QR a la vista, queda el QR plano.
  efecto.alFallar = (e) => {
    if (!efecto.enDestino && !efecto.anim) return;
    console.warn('QR 3D interrumpido, se muestra el QR plano:', e);
    efecto.reiniciar();
    mostrarQrPlano(true);
  };
  return (suelo = efecto);
}
// Antes de la AR: suelta el lienzo 3D del QR para que la cámara y el modelo tengan toda la memoria
// gráfica (con dos contextos WebGL, en celulares modestos el modelo no aparece en la AR). El
// próximo toque al QR lo vuelve a armar en un lienzo nuevo.
let turnoQr = 0;            // cambia cuando algo cancela el QR que se está abriendo
let soltarAlTerminar = false; // la AR empezó mientras el QR se armaba: se suelta al terminar
function soltarSuelo() {
  if (qrPlano) mostrarQrPlano(false);
  turnoQr++;
  if (!suelo) return;
  suelo.reiniciar(); // el modelo vuelve a verse normal al instante, aunque el QR estuviera a medias
  if (abriendo) { soltarAlTerminar = true; return; }
  suelo.destruir();
  suelo = null;
  preparado = null;
  const viejo = $('lienzoQr');
  try { viejo.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* ya no tenía */ }
  viejo.replaceWith(viejo.cloneNode(false)); // un lienzo con el contexto perdido no se puede reusar
}
let modeloCargado = null; // id del modelo que <model-viewer> ya terminó de cargar
let preparado = null; // promesa de suelo.preparar() del modelo actual
// Los QR siempre apuntan a la dirección pública (GitHub Pages), no a la de esta pestaña.
const urlModelo = (m) => urlDe(`ver.html?m=${m.id}`);
let qrPlano = false; // respaldo: QR plano cuando el efecto 3D no puede armarse
function pintarEnQr(enQR) {
  $('btnQr').setAttribute('aria-pressed', String(enQR));
  $('btnQr').setAttribute('aria-label', enQR ? 'Ocultar el código QR' : 'Ver el código QR de este modelo');
  if (enQR) $('btnQr').removeAttribute('aria-busy'); // ya empezó a volar: deja de latir
  escenario.classList.toggle('en-qr', enQR);
  $('leyendaQr').textContent = esEscritorio
    ? 'Escanéalo con tu teléfono · Toca para volver'
    : 'Escanéalo con otro teléfono · Toca para volver';
}
function mostrarQrPlano(si) {
  qrPlano = si;
  const caja = $('qrPlano');
  if (si) caja.innerHTML = qrSvg(urlModelo(modelo), modelo.nombre);
  caja.hidden = !si;
  pintarEnQr(si);
}
const enQr = () => qrPlano || Boolean(suelo?.enDestino);
function cerrarQr() {
  if (qrPlano) mostrarQrPlano(false);
  else if (suelo?.enDestino && !suelo.anim) suelo.ir(0);
}
// Abre el QR escondido en el modelo; si el modelo aún carga, espera, y si el efecto falla en este
// navegador (WebGL, memoria…), muestra el QR plano para que siempre aparezca.
let abriendo = false; // un toque a la vez: los demás se ignoran mientras el QR se prepara
const ocupado = (si) => { abriendo = si; $('btnQr').toggleAttribute('aria-busy', si); };
async function abrirQr() {
  if (enQr()) { cerrarQr(); return; }
  if (abriendo) return;
  const id = modelo.id, turno = turnoQr;
  const vigente = () => modelo.id === id && turnoQr === turno; // ni cambió el modelo ni empezó la AR
  ocupado(true); // el primer toque descarga el motor: el botón late mientras tanto
  try {
    const m = await cargarMotor();
    if (!vigente()) return;
    crearSuelo(m);
    // Si el modelo todavía carga, espera a que esté listo (hasta 15 s).
    for (let t = 0; modeloCargado !== id && t < 150 && vigente(); t++) await new Promise((r) => setTimeout(r, 100));
    if (!vigente()) return;
    if (modeloCargado !== id) throw new Error('El modelo todavía no ha cargado');
    // { diferir }: el modelo se mide una sola vez, ya congelado, al salir en ir(1).
    preparado ??= suelo.preparar({ desde: m.Fuentes.modelViewer(mv), hacia: m.Fuentes.qr(urlModelo(modelo)), diferir: true });
    await preparado;
    if (!vigente()) return;
    await suelo.ir(1);
    // Comprueba que el QR dibujado se pueda leer: si el navegador no lo pintó bien (GPU de
    // iPhone, memoria…), se cambia por el QR plano.
    if (suelo.enDestino && vigente()) {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      // undefined = no se pudo comprobar (sin red para el lector): se deja el QR 3D.
      const leido = await m.leerQR($('lienzoQr')).catch(() => undefined);
      const mal = leido === null || (typeof leido === 'string' && leido !== urlModelo(modelo));
      if (mal && suelo.enDestino && vigente()) throw new Error('El QR 3D no se pudo leer');
    }
  } catch (e) {
    console.warn('QR 3D no disponible, se muestra el QR plano:', e);
    suelo?.reiniciar();
    if (vigente()) mostrarQrPlano(true);
  } finally {
    ocupado(false);
    if (soltarAlTerminar) { soltarAlTerminar = false; soltarSuelo(); }
  }
}
$('btnQr').addEventListener('click', () => { tic(); abrirQr(); });
escenario.addEventListener('click', () => { if (enQr()) cerrarQr(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape' && enQr()) cerrarQr(); });

/* ---------------------------------------------------------------- Respuesta táctil */
let huboToque = false;
addEventListener('pointerdown', () => (huboToque = true), { once: true, capture: true });
const tic = () => { if (huboToque) try { navigator.vibrate?.(8); } catch { /* sin vibración */ } };

document.addEventListener('pointerdown', (e) => {
  const btn = e.target.closest('.btn');
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  btn.style.setProperty('--x', `${e.clientX - r.left}px`);
  btn.style.setProperty('--y', `${e.clientY - r.top}px`);
  btn.classList.remove('tocado');
  void btn.offsetWidth;
  btn.classList.add('tocado');
});

/* ---------------------------------------------------------------- Idioma */
function idiomaInicial() {
  const pedido = params.get('lang');
  if (pedido && IDIOMAS[pedido]) return pedido;
  try {
    const guardado = localStorage.getItem('idioma');
    if (guardado && IDIOMAS[guardado]) return guardado;
  } catch { /* sin almacenamiento */ }
  const nav = (navigator.language || 'es').slice(0, 2);
  return IDIOMAS[nav] ? nav : 'es';
}
const idiomaDe = (m) => (m.narracion?.[idioma] ? idioma : Object.keys(m.narracion || { es: 1 })[0]);

function pintarIdiomas() {
  const disponibles = Object.keys(modelo.narracion || {});
  const caja = $('idiomas');
  caja.hidden = disponibles.length < 2;
  caja.innerHTML = '';
  for (const l of disponibles) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = l.toUpperCase();
    b.title = IDIOMAS[l];
    b.setAttribute('aria-pressed', String(l === idiomaDe(modelo)));
    b.addEventListener('click', () => {
      idioma = l;
      try { localStorage.setItem('idioma', l); } catch { /* sin almacenamiento */ }
      tic();
      pintarIdiomas();
      actualizarUrl();
      if (audio?.sonando) iniciarNarracion();
      prepararQuickLook();
    });
    caja.append(b);
  }
}

/* ---------------------------------------------------------------- Contador tipo odómetro */
const digitos = [];
(function crearContador() {
  const caja = $('contador');
  for (let i = 0; i < 2; i++) {
    const d = document.createElement('span');
    d.className = 'digito';
    const tira = document.createElement('span');
    tira.className = 'tira-digitos';
    tira.innerHTML = Array.from({ length: 10 }, (_, n) => `<span>${n}</span>`).join('');
    d.append(tira);
    caja.append(d);
    digitos.push(tira);
  }
  caja.append(` / ${String(MODELOS.length).padStart(2, '0')}`);
})();
function pintarContador(n) {
  const texto = String(n).padStart(2, '0');
  digitos.forEach((tira, i) => (tira.style.transform = `translateY(${-Number(texto[i]) * 10}%)`));
}

/* ---------------------------------------------------------------- Miniaturas */
for (const [i, m] of MODELOS.entries()) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mini';
  b.setAttribute('aria-label', `${m.nombre}, ${m.variante}`);
  b.innerHTML = `<img src="${m.poster}" alt="" loading="lazy">`;
  b.addEventListener('click', () => ir(i));
  $('miniaturas').append(b);
}
$('anterior').addEventListener('click', () => ir(indice - 1));
$('siguiente').addEventListener('click', () => ir(indice + 1));
addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea')) return;
  if (e.key === 'ArrowRight') ir(indice + 1);
  if (e.key === 'ArrowLeft') ir(indice - 1);
});

/* ---------------------------------------------------------------- Cambio de modelo */
function actualizarUrl() {
  const u = new URL(location.href);
  u.searchParams.set('m', modelo.id);
  if (idiomaDe(modelo) !== 'es') u.searchParams.set('lang', idiomaDe(modelo));
  else u.searchParams.delete('lang');
  u.searchParams.delete('ar'); // la AR directa del QR solo se lanza una vez, no al recargar
  history.replaceState(null, '', u);
}

function ir(nuevo) {
  const i = (nuevo + MODELOS.length) % MODELOS.length;
  if (i === indice) return;
  indice = i;
  tic();
  mostrar(false);
}

let cambio = null;
function mostrar(primera) {
  modelo = MODELOS[indice];
  detenerSonido();
  actualizarUrl();
  document.title = `${modelo.nombre} · Cartagena en AR`;

  pintarContador(indice + 1);
  $('grupo').textContent = GRUPOS[modelo.grupo] || '';
  const nombre = $('nombre');
  nombre.querySelector('span').textContent = modelo.nombre;
  nombre.classList.remove('entra');
  void nombre.offsetWidth;
  nombre.classList.add('entra');
  $('variante').textContent = modelo.variante;
  $('btnHistoria').hidden = !modelo.narracion;
  $('btnMusica').hidden = !modelo.musica;
  $('btnMusica').setAttribute('aria-pressed', 'false');
  pintarIdiomas();

  [...$('miniaturas').children].forEach((b, i) => b.setAttribute('aria-current', String(i === indice)));
  $('miniaturas').children[indice].scrollIntoView({ block: 'nearest', inline: 'center', behavior: primera ? 'auto' : 'smooth' });

  // Al cambiar de modelo el QR se cierra: el modelo nuevo (y el anterior, si se vuelve a él)
  // se ve normal; el QR solo se abre con el botón.
  if (qrPlano) mostrarQrPlano(false);
  preparado = null;
  modeloCargado = null;
  suelo?.reiniciar(); // también limpia una transformación a medias
  $('btnAr').removeAttribute('data-precarga');
  $('btnAr').style.removeProperty('--avance');

  crearSonido();

  clearTimeout(cambio);
  const cargar = () => {
    mv.alt = `${modelo.nombre}, ${modelo.variante}`;
    mv.poster = modelo.poster;
    mv.maxCameraOrbit = modelo.orbitaMax || 'auto auto auto';
    mv.cameraOrbit = modelo.camara || 'auto auto auto';
    mv.src = modelo.glb;
  };
  if (primera) cargar();
  else {
    mv.classList.add('cambiando');
    cambio = setTimeout(cargar, 260);
  }
}

mv.addEventListener('progress', (e) => {
  const p = e.detail.totalProgress;
  if (esperaModelo()) $('arranqueTexto').textContent = `Preparando… ${Math.round(p * 100)}%`;
  $('cargandoBarra').style.width = `${Math.round(p * 100)}%`;
  $('cargandoBarra').style.opacity = p >= 1 ? '0' : '1';
});

mv.addEventListener('load', () => {
  modeloCargado = modelo.id;
  // El motor se descarga en un rato libre para que el primer toque al QR responda al instante.
  // En el teléfono solo se descarga (sin armar el lienzo 3D) y si no llegó a ver la AR directa
  // ni pidió ahorrar datos.
  if (esEscritorio || (!ahorroDatos && !pideAr)) {
    const precalentar = () => cargarMotor().then((m) => { if (esEscritorio) crearSuelo(m); }).catch(() => {});
    if (window.requestIdleCallback) requestIdleCallback(precalentar, { timeout: 4000 });
    else setTimeout(precalentar, 1500); // Safari
  }
  setTimeout(() => mv.classList.remove('cambiando'), 120);
  if (mv.availableAnimations.length) {
    mv.animationName = mv.availableAnimations[0];
    mv.currentTime = 0;
    mv.play();
  }
  setTimeout(revisarAr, 500);
  setTimeout(prepararQuickLook, 700);
});

// Intro + tramo en bucle (las Timelines de Unity con una parte que se repite).
(function vigilarBucle() {
  const b = modelo.bucle;
  if (b && mv.loaded && !mv.paused && mv.currentTime >= b.fin - 1 / 30) {
    mv.currentTime = b.inicio + Math.max(0, mv.currentTime - b.fin);
  }
  requestAnimationFrame(vigilarBucle);
})();

/* ---------------------------------------------------------------- Sonido: narración, efectos y música */
function crearSonido() {
  const narracion = new Audio();
  narracion.preload = 'none';
  audio = {
    narracion,
    sonando: false,
    retraso: null,
    ambiente: modelo.ambiente ? Object.assign(new Audio(modelo.ambiente), { loop: true, volume: 0.35, preload: 'none' }) : null,
    eventos: (modelo.eventos || []).map((e) => ({ ...e, audio: Object.assign(new Audio(e.audio), { preload: 'none' }), hecho: false })),
    musica: modelo.musica ? Object.assign(new Audio(modelo.musica), { loop: true, volume: 0.5, preload: 'none' }) : null,
  };
  const actual = audio;
  // Respaldo del vigía por cuadros (que no corre con la pestaña oculta ni dentro de la AR).
  narracion.addEventListener('timeupdate', () => revisarEventos(actual));
  narracion.addEventListener('ended', () => {
    actual.sonando = false;
    actual.ambiente?.pause();
    pintarHistoria();
  });
  pintarHistoria();
}

// Efectos atados a un momento de la narración (cañón, puerta).
function revisarEventos(actual) {
  if (audio !== actual || !actual.sonando) return;
  const t = actual.narracion.currentTime + (modelo.retrasoNarracion || 0);
  for (const e of actual.eventos) if (!e.hecho && t >= e.t) { e.hecho = true; e.audio.play().catch(() => {}); }
}
// Los revisa en cada cuadro: «timeupdate» solo llega unas 4 veces por segundo.
function vigilarEventos(actual) {
  cancelAnimationFrame(actual.cuadro);
  if (!actual.eventos.length) return;
  const paso = () => {
    if (audio !== actual || !actual.sonando) return;
    revisarEventos(actual);
    actual.cuadro = requestAnimationFrame(paso);
  };
  paso();
}
// iPhone solo deja sonar un audio que arrancó dentro de un toque: los efectos se «desbloquean»
// en el toque de la historia (suenan un instante en silencio) para poder dispararse después.
const desbloqueados = new WeakSet();
function desbloquear(e) {
  const a = e.audio;
  if (desbloqueados.has(a)) return;
  desbloqueados.add(a);
  a.muted = true;
  a.play()
    .then(() => { if (!e.hecho) { a.pause(); a.currentTime = 0; } })
    .catch(() => { desbloqueados.delete(a); })
    .finally(() => { a.muted = false; });
}

// Al ocultar la pestaña se pausa lo que suena; al volver, sigue donde iba.
let pausados = [];
document.addEventListener('visibilitychange', () => {
  if (!audio) return;
  if (document.hidden) {
    pausados = [audio.narracion, audio.ambiente, audio.musica, ...audio.eventos.map((e) => e.audio)]
      .filter((a) => a && !a.paused);
    pausados.forEach((a) => a.pause());
  } else {
    const actual = audio;
    for (const a of pausados) {
      a.play().catch(() => {
        // El navegador no dejó reanudar sin un toque: los botones vuelven a su estado real.
        if (audio !== actual) return;
        if (a === actual.narracion) detenerNarracion();
        if (a === actual.musica) { $('btnMusica').setAttribute('aria-pressed', 'false'); $('arMusica').setAttribute('aria-pressed', 'false'); }
      });
    }
    pausados = [];
    vigilarEventos(actual);
  }
});

function pintarHistoria() {
  const texto = audio?.sonando ? '■ Detener historia' : '▶ Historia';
  $('btnHistoriaTexto').textContent = texto;
  $('btnHistoria').setAttribute('aria-pressed', String(Boolean(audio?.sonando)));
  $('arHistoria').textContent = audio?.sonando ? '■ Detener historia' : '▶ Escuchar historia';
  $('arHistoria').hidden = !modelo.narracion;
}

function detenerNarracion() {
  if (!audio) return;
  audio.sonando = false;
  pausados = [];
  cancelAnimationFrame(audio.cuadro);
  clearTimeout(audio.retraso);
  audio.narracion.pause();
  audio.ambiente?.pause();
  audio.eventos.forEach((e) => { e.audio.pause(); e.hecho = false; });
  pintarHistoria();
}

function detenerSonido() {
  detenerNarracion();
  audio?.musica?.pause();
  $('arMusica').setAttribute('aria-pressed', 'false');
}

function iniciarNarracion() {
  if (!modelo.narracion || !audio) return;
  clearTimeout(audio.retraso);
  audio.sonando = true;
  audio.narracion.src = modelo.narracion[idiomaDe(modelo)];
  audio.narracion.currentTime = 0;
  audio.eventos.forEach((e) => { e.hecho = false; e.audio.pause(); e.audio.currentTime = 0; desbloquear(e); });
  if (modelo.sincronizar && mv.availableAnimations.length) {
    mv.currentTime = 0; // la animación arranca con la voz, como en la Timeline de Unity
    mv.play();
  }
  if (audio.ambiente) { audio.ambiente.currentTime = 0; audio.ambiente.play().catch(() => {}); }
  const actual = audio;
  const sonar = () => actual.narracion.play().catch(() => {});
  // Sin retraso suena dentro del mismo toque (iPhone lo exige); con retraso, un instante después.
  if (modelo.retrasoNarracion) audio.retraso = setTimeout(sonar, modelo.retrasoNarracion * 1000);
  else sonar();
  vigilarEventos(actual);
  pintarHistoria();
}

const alternarHistoria = () => { tic(); audio?.sonando ? detenerNarracion() : iniciarNarracion(); };
$('btnHistoria').addEventListener('click', alternarHistoria);
$('arHistoria').addEventListener('click', alternarHistoria);

function alternarMusica() {
  const m = audio?.musica;
  if (!m) return;
  tic();
  const encender = m.paused;
  encender ? m.play().catch(() => {}) : m.pause();
  $('btnMusica').setAttribute('aria-pressed', String(encender));
  $('arMusica').setAttribute('aria-pressed', String(encender));
}
$('btnMusica').addEventListener('click', alternarMusica);
$('arMusica').addEventListener('click', alternarMusica);

/* ---------------------------------------------------------------- Realidad aumentada */
function avisar(texto) {
  $('aviso').innerHTML = texto;
  $('aviso').hidden = !texto;
}

// Android fuera de Chrome (Samsung Internet, apps…): se abre en Chrome, donde la AR va con la
// historia. Si el teléfono no tiene Chrome, vuelve aquí con chrome=no y usa la AR que haya.
const sinChrome = params.get('chrome') === 'no';
const mandarAChrome = esAndroid && !enChromeAndroid && !sinChrome;
const arAqui = () => conQuickLook || (mv.canActivateAR && !mandarAChrome);

function revisarAr() {
  const btn = $('btnAr');
  btn.hidden = false;
  avisar('');
  if (arAqui()) {
    $('btnArTexto').textContent = 'Ver en tu espacio';
  } else if (esEscritorio) {
    $('btnArTexto').textContent = 'Ver en tu celular';
  } else if (mandarAChrome) {
    $('btnArTexto').textContent = 'Abrir en Chrome';
  } else if (esIOS && enAppExterna) {
    btn.hidden = true;
    avisar('Para verlo en tu espacio, abre esta página en Safari: toca ••• y elige «Abrir en el navegador».');
  } else {
    btn.hidden = true;
    avisar('Este celular no permite realidad aumentada, pero puedes girar el modelo aquí.');
  }
  $('arMusica').hidden = !modelo.musica;
  // Llegada por QR en Chrome Android: el toque para la AR se habilita cuando el modelo está listo.
  if (esperaModelo()) {
    if (mv.canActivateAR) {
      $('arranqueBtn').disabled = false;
      $('arranqueTexto').textContent = 'Toca para verlo en tu espacio';
    } else {
      cerrarArranque();
    }
  }
}

// iPhone: descarga el USDZ en segundo plano para que Quick Look abra al instante.
function prepararQuickLook() {
  if (!conQuickLook || ahorroDatos || !mv.loaded) return;
  const btn = $('btnAr');
  const url = usdzDe(modelo, idiomaDe(modelo));
  const id = modelo.id;
  btn.setAttribute('data-precarga', 'cargando');
  precargar(url, (p) => { if (modelo.id === id) btn.style.setProperty('--avance', p.toFixed(3)); })
    .then(() => { if (modelo.id === id) btn.setAttribute('data-precarga', 'listo'); })
    .catch(() => { if (modelo.id === id) btn.removeAttribute('data-precarga'); });
}

$('btnAr').addEventListener('click', () => { tic(); abrirAr(); });

function abrirAr() {
  if (conQuickLook) {
    detenerSonido(); // el USDZ ya trae la narración
    const siguiente = MODELOS[(indice + 1) % MODELOS.length];
    abrirQuickLook({
      url: usdzDe(modelo, idiomaDe(modelo)),
      titulo: `${modelo.nombre} · ${modelo.variante}`,
      subtitulo: `Cartagena en AR · ${String(indice + 1).padStart(2, '0')}/${String(MODELOS.length).padStart(2, '0')}`,
      accion: `Siguiente: ${siguiente.nombre}`,
      alTocarAccion: () => ir(indice + 1),
    });
  } else if (arAqui()) {
    soltarSuelo(); // libera la memoria gráfica del QR antes de abrir la cámara
    mv.activateAR(); // WebXR; si falla, model-viewer pasa solo a Scene Viewer
  } else if (esEscritorio) {
    if (!enQr()) abrirQr(); // en el computador, el QR escondido en el modelo lo lleva al teléfono
  } else if (mandarAChrome) {
    // En Chrome se abre de nuevo directo a la AR de este modelo.
    const u = new URL(location.href);
    u.searchParams.set('ar', '1');
    location.href = enlaceChrome(u.href);
  }
}

/* ---------------------------------------------------------------- Llegada por QR: AR directa */
// Los QR apuntan a ver.html?m=<id>, que llega aquí con ar=1: se abre la AR de ese modelo de una
// vez y, al salir de ella, queda su página. iPhone: Quick Look se lanza solo (si Safari pide un
// toque, queda la pantalla para tocar). Android: Chrome exige un toque para empezar la AR, así que
// toda la pantalla es el botón.
const arranque = $('arranque');
const pideAr = params.get('ar') === '1' && !esEscritorio;

function esperaModelo() {
  return !arranque.hidden && esAndroid && !mandarAChrome && !conQuickLook;
}

function cerrarArranque() {
  arranque.hidden = true;
}

function prepararArranque() {
  if (!pideAr || (!conQuickLook && !esAndroid) || enAppExterna) return;
  $('arranquePoster').src = modelo.poster;
  $('arranquePoster').alt = modelo.nombre;
  $('arranqueNombre').textContent = modelo.nombre;
  arranque.hidden = false;
  if (conQuickLook) {
    let salio = false;
    const marcar = () => { salio = true; };
    addEventListener('blur', marcar, { once: true });
    addEventListener('pagehide', marcar, { once: true });
    document.addEventListener('visibilitychange', marcar, { once: true });
    abrirAr();
    // Si Quick Look se abrió, al volver ya está la página; si no, queda el botón de un toque.
    setTimeout(() => { if (salio) cerrarArranque(); }, 1200);
  } else if (mandarAChrome) {
    $('arranqueTexto').textContent = 'Toca para abrirlo en Chrome';
  } else {
    $('arranqueBtn').disabled = true;
    $('arranqueTexto').textContent = 'Preparando…';
  }
}

arranque.addEventListener('click', (e) => {
  if (e.target.closest('#arranqueSalir')) { cerrarArranque(); return; }
  if ($('arranqueBtn').disabled) return;
  tic();
  cerrarArranque();
  abrirAr();
});

// Android (WebXR): la historia arranca cuando se coloca el modelo y se detiene al salir.
let enAr = false;
let colocado = false;
mv.addEventListener('ar-status', (e) => {
  const s = e.detail.status;
  if (s === 'session-started') { enAr = true; colocado = false; }
  else if (s === 'object-placed' && enAr && !colocado) { colocado = true; iniciarNarracion(); }
  else if (s === 'not-presenting' && enAr) { enAr = false; detenerSonido(); }
  else if (s === 'failed') {
    // Ni WebXR ni Scene Viewer pudieron abrir: suele faltar la app de AR de Google.
    enAr = false;
    $('btnAr').hidden = true;
    avisar('No se pudo abrir la realidad aumentada. Instala o actualiza «Servicios de Google Play para RA» desde Play Store y vuelve a intentarlo; mientras tanto puedes girar el modelo aquí.');
  }
});
// Si el celular pierde el espacio (poca luz, piso liso), se le dice qué hacer.
mv.addEventListener('ar-tracking', (e) => {
  $('arAyuda').textContent = e.detail.status === 'not-tracking'
    ? 'Mueve el celular despacio y apunta a un piso con textura y buena luz'
    : 'Apunta al piso y toca para colocarlo';
});

mostrar(true);
prepararArranque();
