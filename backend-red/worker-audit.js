const { exec } = require('child_process');
const http = require('http');
const https = require('https');
const tls = require('tls');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const EventModule = require('eventsource');
global.EventSource = EventModule.EventSource || EventModule;
const PocketBase = require('pocketbase/cjs');

const PB_URL = process.env.PUBLIC_POCKETBASE_INTERNAL_URL || process.env.PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090';
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL;
const PB_ADMIN_PASS = process.env.PB_ADMIN_PASS;

const pb = new PocketBase(PB_URL);
pb.autoCancellation(false);

const activosEnAuditoria = new Set();
let suscripcionRealtimeActiva = false;

function ejecutarComando(cmd) {
  return new Promise((resolve) => {
    exec(cmd, (error, stdout) => {
      if (error) return resolve('');
      resolve(stdout);
    });
  });
}

function resolverNombreContenedor(ip, hostname = '') {
  const h = hostname.toLowerCase();
  if (ip.endsWith('.2') || h.includes('nvr-lab')) return 'nvr-lab';
  if (ip.endsWith('.3') || h.includes('servidor-lab')) return 'servidor-lab';
  if (ip.endsWith('.4') || h.includes('tls')) return 'servidor-tls';
  if (ip.endsWith('.5') || h.includes('router')) return 'router-legacy';
  if (ip.endsWith('.6') || h.includes('win')) return 'win-vulnerable';
  if (ip.endsWith('.7') || h.includes('nvr-vulnerable')) return 'nvr-vulnerable';
  return null;
}

async function obtenerPuertosMapeadosContenedor(containerName) {
  if (!containerName) return [];
  let stdout = await ejecutarComando(`docker port ${containerName}`);
  if (!stdout.trim()) {
    stdout = await ejecutarComando(`podman port ${containerName}`);
  }
  const mapeos = [];
  if (!stdout) return mapeos;

  const lineas = stdout.trim().split('\n');
  lineas.forEach(linea => {
    const partes = linea.split('->');
    if (partes.length === 2) {
      const puertoInterno = partes[0].trim().split('/')[0];
      const puertoHost = partes[1].trim().split(':')[1];
      mapeos.push({ interno: puertoInterno, host: puertoHost });
    }
  });
  return mapeos;
}

async function escanearPuertosActivo(ip, activo) {
  let puertosAbiertos = [];

  if (ip.startsWith('172.18.') || ip.startsWith('172.17.') || ip.startsWith('10.89.') || ip.startsWith('10.88.')) {
    const containerName = resolverNombreContenedor(ip, activo.hostname);
    const mapeos = await obtenerPuertosMapeadosContenedor(containerName);

    for (const m of mapeos) {
      const comando = `nmap --unprivileged -p ${m.host} --open -T4 -Pn 127.0.0.1`;
      const salida = await ejecutarComando(comando);
      if (salida.includes('open')) {
        puertosAbiertos.push(m.interno);
      }
    }
  } else {
    const puertosComunes = "22,80,443,554,3389,13389";
    const comando = `nmap --unprivileged -p ${puertosComunes} --open -T4 -Pn ${ip}`;
    const salida = await ejecutarComando(comando);

    const lineas = salida.split('\n');
    lineas.forEach(linea => {
      if (linea.includes('/tcp') && linea.includes('open')) {
        const puertoNum = linea.trim().split(/\s+/)[0].split('/')[0];
        puertosAbiertos.push(puertoNum);
      }
    });
  }

  return [...new Set(puertosAbiertos)];
}

// Verificación previa de Reto HTTP (WWW-Authenticate / código 401)
function verificarRetoAutenticacionHttp(targetIp, targetPort) {
  return new Promise((resolve) => {
    const protocol = (targetPort === '443' || targetPort === '8443') ? https : http;
    const options = {
      hostname: targetIp,
      port: parseInt(targetPort),
      path: '/',
      method: 'GET',
      timeout: 3000
    };

    const req = protocol.request(options, (res) => {
      const authHeader = res.headers['www-authenticate'];
      // Si responde con 401 Unauthorized o incluye cabecera de autenticación básica/digest
      if (res.statusCode === 401 || (authHeader && authHeader.length > 0)) {
        resolve(true);
      } else {
        resolve(false);
      }
    });

    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

function probarCredencialHttp(targetIp, targetPort, user, pass) {
  return new Promise((resolve) => {
    const protocol = (targetPort === '443' || targetPort === '8443') ? https : http;
    const auth = Buffer.from(`${user}:${pass}`).toString('base64');

    const options = {
      hostname: targetIp,
      port: parseInt(targetPort),
      path: '/',
      method: 'GET',
      headers: { 'Authorization': `Basic ${auth}` },
      timeout: 3000
    };

    const req = protocol.request(options, (res) => {
      if (res.statusCode === 200 || res.statusCode === 204) {
        resolve(true);
      } else {
        resolve(false);
      }
    });

    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

async function verificarPasswordDefault(ip, puertos, activo) {
  const tipoUpper = (activo.tipo || '').toUpperCase();

  // Segmentación por tipo de activo.
  // Los servidores no ejecutan pruebas de contraseñas HTTP por defecto en puertos web públicos.
  if (tipoUpper === 'SERVIDOR') {
    return false;
  }

  let targetIp = ip;
  let targetPort = puertos.includes('443') ? '443' : (puertos.includes('80') ? '80' : null);

  if (ip.startsWith('172.18.') || ip.startsWith('172.17.') || ip.startsWith('10.89.') || ip.startsWith('10.88.')) {
    targetIp = '127.0.0.1';
    const containerName = resolverNombreContenedor(ip, activo.hostname);
    const mapeos = await obtenerPuertosMapeadosContenedor(containerName);
    const mapWeb = mapeos.find(m => m.interno === '80' || m.interno === '443');
    if (mapWeb) targetPort = mapWeb.host;
    else targetPort = null;
  }

  if (!targetPort) return false;

  // Pre-análisis de reto HTTP. 
  // Si la web responde 200 OK abierto sin exigir autenticación, se descarta el ataque de credenciales.
  const requiereAuth = await verificarRetoAutenticacionHttp(targetIp, targetPort);
  if (!requiereAuth) {
    return false;
  }

  const credencialesDefault = [
    { user: 'admin', pass: ''},
    { user: 'admin', pass: 'admin' },
    { user: 'admin', pass: '12345' },
    { user: 'root', pass: ''},
    { user: 'root', pass: 'root' }
  ];

  for (const cred of credencialesDefault) {
    const esVulnerable = await probarCredencialHttp(targetIp, targetPort, cred.user, cred.pass);
    if (esVulnerable) return true;
  }

  return false;
}

function obtenerFirmaHTTP(targetIp, targetPort) {
  return new Promise((resolve) => {
    if (!targetPort) return resolve(null);

    const protocol = (targetPort === '443' || targetPort === '8443') ? https : http;
    const options = {
      hostname: targetIp,
      port: parseInt(targetPort),
      path: '/',
      method: 'HEAD',
      timeout: 3000
    };

    const req = protocol.request(options, (res) => {
      const serverHeader = res.headers['server'];
      if (serverHeader && serverHeader.trim() !== '') {
        resolve(serverHeader);
      } else {
        resolve(null);
      }
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

function obtenerFirmaTLS(targetIp, targetPort) {
  return new Promise((resolve) => {
    if (!targetPort) return resolve(null);

    const socket = tls.connect({
      host: targetIp,
      port: parseInt(targetPort),
      rejectUnauthorized: false,
      timeout: 3000
    }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();

      if (cert && cert.subject) {
        const emisor = cert.subject.O || cert.subject.OU || cert.subject.CN;
        if (emisor) return resolve(`TLS Cert: ${emisor}`);
      }
      resolve(null);
    });

    socket.on('error', () => resolve(null));
    socket.on('timeout', () => { socket.destroy(); resolve(null); });
  });
}

async function obtenerFirmaNmap(targetIp, targetPort) {
  if (!targetPort) return null;
  
  const cmd = `nmap --unprivileged -sV --version-intensity 2 -p ${targetPort} ${targetIp}`;
  const salida = await ejecutarComando(cmd);

  const lineas = salida.split('\n');
  const lineaServicio = lineas.find(l => l.includes(`${targetPort}/tcp`));

  if (lineaServicio && lineaServicio.includes('open')) {
    const partes = lineaServicio.trim().split(/\s+/);
    const versionInfo = partes.slice(3).join(' ');
    if (versionInfo && versionInfo !== 'unknown') {
      return `Nmap Service: ${versionInfo}`;
    }
  }

  return null;
}

async function obtenerFirmaFirmwareHibrida(targetIp, targetPort) {
  if (!targetPort) return 'Sin servicio web expuesto';

  const firmaHTTP = await obtenerFirmaHTTP(targetIp, targetPort);
  if (firmaHTTP) return `HTTP Banner: ${firmaHTTP}`;

  if (targetPort === '443' || targetPort === '8443') {
    const firmaTLS = await obtenerFirmaTLS(targetIp, targetPort);
    if (firmaTLS) return firmaTLS;
  }

  const firmaNmap = await obtenerFirmaNmap(targetIp, targetPort);
  if (firmaNmap) return firmaNmap;

  return 'Protegido / Cabecera Omitida (Hardened)';
}

// Cálculo de score optimizado y ponderación justa para servidores web
function calcularScoreRed(passDefault, puertos, tipoActivo, firma) {
  let score = 100;
  const tipoUpper = (tipoActivo || '').toUpperCase();

  // La penalización grave por contraseña por defecto solo aplica si se detectó y verificó en dispositivos compatibles (como NVRs)
  if (passDefault) score -= 40;
  
  // Penalización si un NVR tiene SSH abierto (no debería)
  if (puertos.includes('22') && tipoUpper === 'NVR') score -= 25;
  
  // Penalización por INCONGRUENCIA: Si un Servidor o PC expone RTSP (554) típico de cámaras
  if (puertos.includes('554') && (tipoUpper === 'SERVIDOR' || tipoUpper === 'PC')) score -= 20;

  if (puertos.includes('3389')) score -= 20;
  
  // Penalización menor controlada por fuga de versión exacta de servidor (ej. Apache/2.4.63)
  if (firma && firma.match(/\/[0-9]+\.[0-9]+/)) score -= 15;
  
  return Math.max(0, score);
}

async function auditarActivoIndividual(activo) {
  if (!activo || !activo.ip) return;

  console.log(`[AUDITORÍA SOLICITADA] Auditando activo: ${activo.hostname} (${activo.ip})...`);

  const puertosAbiertos = await escanearPuertosActivo(activo.ip, activo);
  const estaOnline = puertosAbiertos.length > 0;

  if (!estaOnline) {
    console.log(`[AVISO] ${activo.hostname} (${activo.ip}) está OFFLINE. Actualizando score a 0...`);
    
    await pb.collection('activos').update(activo.id, { 
      score_seguridad: 0,
      forzar_escaneo_manual: false 
    });

    try {
      const existente = await pb.collection('evaluaciones_red').getFirstListItem(`relation="${activo.id}"`);
      await pb.collection('evaluaciones_red').update(existente.id, {
        estado_conexion: "Offline",
        score: 0,
        vulnerabilidades: JSON.stringify(["Dispositivo fuera de línea / Inalcanzable"])
      });
    } catch (e) {
      await pb.collection('evaluaciones_red').create({
        relation: activo.id,
        host_asociado: activo.hostname,
        ip_asociada: activo.ip,
        puertos_abiertos: JSON.stringify([]),
        password_default: false,
        firmware: "Desconectado / Inalcanzable",
        vulnerabilidades: JSON.stringify(["Dispositivo fuera de línea"]),
        estado_conexion: "Offline",
        score: 0
      });
    }
    return;
  }

  const passDefaultDetectada = await verificarPasswordDefault(activo.ip, puertosAbiertos, activo);

  let targetIpHeader = activo.ip;
  let targetPortHeader = null;

  if (activo.ip.startsWith('172.18.') || activo.ip.startsWith('172.17.') || activo.ip.startsWith('10.89.') || activo.ip.startsWith('10.88.')) {
    targetIpHeader = '127.0.0.1';
    const containerName = resolverNombreContenedor(activo.ip, activo.hostname);
    const mapeos = await obtenerPuertosMapeadosContenedor(containerName);
    const mapWeb = mapeos.find(m => m.interno === '80' || m.interno === '443');
    if (mapWeb) targetPortHeader = mapWeb.host;
  } else {
    if (puertosAbiertos.includes('443')) targetPortHeader = '443';
    else if (puertosAbiertos.includes('80')) targetPortHeader = '80';
  }

  const firmaDetectada = await obtenerFirmaFirmwareHibrida(targetIpHeader, targetPortHeader);

  let vulnerabilidadesTemp = [];
  if (passDefaultDetectada) vulnerabilidadesTemp.push("Contraseña por defecto de fábrica detectada vía HTTP");
  
  const tipoUpper = (activo.tipo || '').toUpperCase();

  // Validación de SSH en NVR
  if (puertosAbiertos.includes('22') && tipoUpper === 'NVR') {
    vulnerabilidadesTemp.push("Puerto SSH 22 abierto en dispositivo NVR");
  }

  // Validación de Incongruencia: Servidor/PC con servicio de video RTSP
  if (puertosAbiertos.includes('554') && (tipoUpper === 'SERVIDOR' || tipoUpper === 'PC')) {
    vulnerabilidadesTemp.push(`Anomalía de Clasificación: ${activo.tipo} expone servicio RTSP (554), típico de cámaras/NVR`);
  }

  if (puertosAbiertos.includes('3389')) {
    vulnerabilidadesTemp.push("Servicio de Escritorio Remoto RDP (3389) expuesto directamente sin VPN");
  }
  
  if (firmaDetectada && firmaDetectada.match(/\/[0-9]+\.[0-9]+/)) {
    vulnerabilidadesTemp.push("Fuga de información: Versión exacta del servidor expuesta");
  }
  
  let vulnerabilidades = [...new Set(vulnerabilidadesTemp)];

  if (vulnerabilidades.length === 0) {
    vulnerabilidades.push("Sin vulnerabilidades críticas detectadas");
  }

  const nuevoScore = calcularScoreRed(passDefaultDetectada, puertosAbiertos, activo.tipo, firmaDetectada);

  await pb.collection('activos').update(activo.id, { 
    score_seguridad: nuevoScore,
    forzar_escaneo_manual: false
  });

  const payloadEvaluacionRed = {
    relation: activo.id,
    host_asociado: activo.hostname,
    ip_asociada: activo.ip,
    puertos_abiertos: JSON.stringify(puertosAbiertos),
    password_default: passDefaultDetectada,
    firmware: firmaDetectada,
    vulnerabilidades: JSON.stringify(vulnerabilidades),
    estado_conexion: "Online",
    score: nuevoScore
  };

  try {
    const existente = await pb.collection('evaluaciones_red').getFirstListItem(`relation="${activo.id}"`);
    await pb.collection('evaluaciones_red').update(existente.id, payloadEvaluacionRed);
  } catch (e) {
    try {
      await pb.collection('evaluaciones_red').create(payloadEvaluacionRed);
    } catch (createErr) {
      console.error(`Error guardando en PocketBase para ${activo.hostname}:`, createErr.message);
    }
  }

  console.log(`[AUDITORÍA FINALIZADA] ${activo.hostname} (${activo.tipo}) -> Score: ${nuevoScore}/100`);
}

async function limpiarSolicitudesPendientes() {
  try {
    const activos = await pb.collection('activos').getFullList();
    let reseteados = 0;
    for (const activo of activos) {
      if (activo.forzar_escaneo_manual) {
        await pb.collection('activos').update(activo.id, { forzar_escaneo_manual: false });
        reseteados++;
      }
    }
    if (reseteados > 0) {
      console.log(`[INICIO] Se limpiaron ${reseteados} banderas residuales de re-escaneo.`);
    }
  } catch (err) {
    console.error('Error limpiando solicitudes pendientes:', err.message);
  }
}

async function iniciarSuscripcionRealtime() {
  if (suscripcionRealtimeActiva) return;

  try {
    await pb.collection('activos').subscribe('*', async (e) => {
      if (e.action === 'update' && e.record) {
        console.log(`[REALTIME RECIBIDO] Activo: ${e.record.hostname} | Flag: ${e.record.forzar_escaneo_manual}`);
      }

      const esSolicitudManual = e.action === 'update' && 
        (e.record.forzar_escaneo_manual === true || String(e.record.forzar_escaneo_manual).toLowerCase() === 'true');

      if (esSolicitudManual) {
        const tipoNormalizado = (e.record.tipo || '').toLowerCase();
        
        if (tipoNormalizado === 'servidor' || tipoNormalizado === 'nvr') {
          const assetId = e.record.id;

          if (activosEnAuditoria.has(assetId)) {
            console.log(`[REALTIME OMITE] ${e.record.hostname} ya está en proceso de auditoría.`);
            return;
          }

          activosEnAuditoria.add(assetId);
          console.log(`\n[REALTIME EVENT] Solicitud de re-escaneo recibida para: ${e.record.hostname}`);

          try {
            await auditarActivoIndividual(e.record);
          } catch (err) {
            console.error(`Error durante el re-escaneo manual de ${e.record.hostname}:`, err.message);
          } finally {
            activosEnAuditoria.delete(assetId);
          }
        }
      }
    });

    suscripcionRealtimeActiva = true;
    console.log('[REALTIME] Escuchando solicitudes de re-escaneo manual para Servidores/NVRs...');
  } catch (err) {
    console.error('Error suscribiendo a Realtime:', err.message);
  }
}

async function cicloAuditoriaRed() {
  if (!PB_ADMIN_EMAIL || !PB_ADMIN_PASS) {
    console.error('Credenciales de administrador de PocketBase no definidas en .env');
    setTimeout(cicloAuditoriaRed, 30000);
    return;
  }

  try {
    await pb.collection('_superusers').authWithPassword(PB_ADMIN_EMAIL, PB_ADMIN_PASS);
    await limpiarSolicitudesPendientes();
    await iniciarSuscripcionRealtime();
  } catch (authErr) {
    console.error('Error de autenticación en PocketBase:', authErr.message);
    setTimeout(cicloAuditoriaRed, 30000);
    return;
  }

  try {
    const activos = await pb.collection('activos').getFullList({
      filter: 'tipo = "Servidor" || tipo = "NVR"'
    });

    console.log(`[AUDITORÍA PROGRAMADA] Iniciando análisis de ${activos.length} activos...`);

    for (const activo of activos) {
      await auditarActivoIndividual(activo);
    }

  } catch (err) {
    console.error('Error durante el ciclo de auditoría:', err.message);
  }

  setTimeout(cicloAuditoriaRed, 3600000);
}

cicloAuditoriaRed();