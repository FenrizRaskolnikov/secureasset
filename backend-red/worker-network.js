const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
require('dotenv').config();
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const PocketBase = require('pocketbase/cjs');

const PB_URL = process.env.PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090';
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL;
const PB_ADMIN_PASS = process.env.PB_ADMIN_PASS;

console.log(`[CONFIG] Conectando a PocketBase en: ${PB_URL} con usuario: ${PB_ADMIN_EMAIL || 'NO DEFINIDO'}`);

const pb = new PocketBase(PB_URL);
let macsVistasEnMemoria = new Set();

function clasificarPorOUI(mac) {
  if (!mac) return null;
  const prefix = mac.substring(0, 8).toLowerCase();

  const nvrOUIs = ['4c:11:bf', '00:12:17', '38:97:d6', 'c4:34:6b', '00:48:08', 'bc:32:5f', '44:19:ec', 'e0:d5:5e'];
  const printerOUIs = ['00:00:aa', 'f4:b5:49', '00:1b:a9', '28:29:86', '00:04:76'];
  const mobileOUIs = ['14:dd:a9', 'bc:9f:ef', '08:ed:ed', 'f8:ff:c2', '00:17:fa', '28:6a:ba'];
  const serverOUIs = ['00:14:22', '18:66:da', 'b0:26:28', '00:25:b3', '00:50:56', '00:0c:29', '00:15:5d'];
  const pcOUIs = ['00:1e:67', '00:21:5c', '00:22:fb', '00:23:24', '00:24:d7', '00:0e:c6', '52:54:00', '00:26:55', 'b8:ae:ed', '74:d4:35'];

  if (nvrOUIs.some(oui => prefix.startsWith(oui))) {
    console.log(`[OUI MATCH] MAC ${mac} (prefijo ${prefix}) identificado como NVR`);
    return { tipo: 'NVR', fabricante: 'Cámara / Grabador NVR (OUI)' };
  }
  if (printerOUIs.some(oui => prefix.startsWith(oui))) {
    console.log(`[OUI MATCH] MAC ${mac} (prefijo ${prefix}) identificado como Impresora`);
    return { tipo: 'Impresora', fabricante: 'Impresora de Red (OUI)' };
  }
  if (mobileOUIs.some(oui => prefix.startsWith(oui))) {
    console.log(`[OUI MATCH] MAC ${mac} (prefijo ${prefix}) identificado como Mobile`);
    return { tipo: 'Mobile', fabricante: 'Dispositivo Móvil (OUI)' };
  }
  if (serverOUIs.some(oui => prefix.startsWith(oui))) {
    console.log(`[OUI MATCH] MAC ${mac} (prefijo ${prefix}) identificado como Servidor`);
    return { tipo: 'Servidor', fabricante: 'Servidor / Datacenter (OUI)' };
  }
  if (pcOUIs.some(oui => prefix.startsWith(oui))) {
    console.log(`[OUI MATCH] MAC ${mac} (prefijo ${prefix}) identificado como PC`);
    return { tipo: 'PC', fabricante: 'PC / Endpoint (OUI)' };
  }

  console.log(`[OUI MISS] Prefijo ${prefix} de la MAC ${mac} no está en OUI conocidos.`);
  return null;
}

function verificarPuerto(ip, puerto, timeout = 400) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeout);
    socket.on('connect', () => {
      console.log(`[TCP-PORT] ¡Puerto ${puerto} ABIERTO en IP ${ip}!`);
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error', () => { socket.destroy(); resolve(false); });
    socket.connect(puerto, ip);
  });
}

function inferirPorWebHTTP(ip) {
  return new Promise((resolve) => {
    console.log(`[HTTP-WEB] Intentando banner grabbing web en http://${ip}...`);
    const req = http.get(`http://${ip}`, { timeout: 800 }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        const lowerData = data.toLowerCase();
        console.log(`[HTTP-WEB] Respuesta exitosa de IP ${ip} (Status: ${res.statusCode}). Analizando contenido...`);

        if (lowerData.includes('printer') || lowerData.includes('laserjet') || lowerData.includes('epson')) {
          console.log(`[HTTP-WEB] -> Detectada Impresora por contenido web en ${ip}`);
          resolve({ tipo: 'Impresora', fabricante: 'Impresora de Red (Detección Web)' });
        } else if (lowerData.includes('nvr') || lowerData.includes('dvr') || lowerData.includes('hikvision') || lowerData.includes('dahua')) {
          console.log(`[HTTP-WEB] -> Detectado NVR por contenido web en ${ip}`);
          resolve({ tipo: 'NVR', fabricante: 'Cámara / NVR (Detección Web)' });
        } else if (lowerData.includes('nas') || lowerData.includes('synology') || lowerData.includes('qnap')) {
          console.log(`[HTTP-WEB] -> Detectado Servidor NAS por contenido web en ${ip}`);
          resolve({ tipo: 'Servidor', fabricante: 'Servidor NAS (Detección Web)' });
        } else {
          console.log(`[HTTP-WEB] -> Servidor web activo en ${ip}, sin firmas específicas.`);
          resolve({ tipo: 'PC / Servidor / Otro', fabricante: 'Servicio Web Genérico' });
        }
      });
    });

    req.on('error', () => {
      console.log(`[HTTP-WEB] Sin servicio web o puerto 80 cerrado en ${ip}`);
      resolve(null);
    });
    req.on('timeout', () => {
      console.log(`[HTTP-WEB] Timeout conectando por web a ${ip}`);
      req.destroy();
      resolve(null);
    });
  });
}

async function inferirTipoPorServicios(ip) {
  console.log(`[SERVICES] Iniciando sondeo TCP de puertos (554, 8000, 445, 631, 22) para IP: ${ip}`);
  try {
    const [p554, p8000, p445, p631, p22] = await Promise.all([
      verificarPuerto(ip, 554),
      verificarPuerto(ip, 8000),
      verificarPuerto(ip, 445),
      verificarPuerto(ip, 631),
      verificarPuerto(ip, 22)
    ]);

    if (p554 || p8000) return { tipo: 'NVR', fabricante: 'Cámara / NVR (Inferido por Puertos)' };
    if (p445) return { tipo: 'PC', fabricante: 'Endpoint Windows (Inferido por SMB)' };
    if (p631) return { tipo: 'Impresora', fabricante: 'Impresora de Red (Inferido por IPP)' };
    if (p22) return { tipo: 'Servidor', fabricante: 'Servidor / Linux (Inferido por SSH)' };

    console.log(`[SERVICES] Puertos estándar cerrados en ${ip}. Pasando a inspección HTTP Web...`);
    const webResult = await inferirPorWebHTTP(ip);
    if (webResult) return webResult;

  } catch (e) {
    console.error(`[SERVICES ERROR] Error sondeando ${ip}:`, e.message);
  }
  return null;
}

function escanearRedNmap() {
  return new Promise((resolve) => {
    const dispositivos = [];
    const targetSubnet = process.env.TARGET_SUBNET || '192.168.10.0/24'; 
    const subnetBase = targetSubnet.substring(0, targetSubnet.lastIndexOf('.'));

    console.log(`[DEBUG] Ejecutando sondeo unprivileged en la subred: ${targetSubnet}`);

    // nmap unprivileged con puertos clave para forzar al kernel a poblar /proc/net/arp con todos los hosts
    exec(`nmap -p 80,445,22 --unprivileged ${targetSubnet}`, async (err) => {
      if (err) console.error('[NMAP ERROR]', err.message);

      try {
        if (fs.existsSync('/proc/net/arp')) {
          const arpData = fs.readFileSync('/proc/net/arp', 'utf8');
          const lines = arpData.split('\n');

          for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            const parts = line.split(/\s+/);
            const ip = parts[0];
            const mac = parts[3] ? parts[3].toLowerCase() : '';

            if (ip && ip.startsWith(subnetBase + '.') && mac && mac !== '00:00:00:00:00:00' && mac.includes(':')) {
              if (!dispositivos.some(d => d.ip === ip)) {
                dispositivos.push({ ip, mac });
              }
            }
          }
        }
      } catch (arpErr) {
        console.error('[ARP ERROR]', arpErr.message);
      }

      console.log(`[DEBUG] Dispositivos extraídos de tabla ARP: ${dispositivos.length}. Iniciando análisis...`);

      const dispositivosProcesados = [];
      for (const dev of dispositivos) {
        if (dev.ip.startsWith('172.') || dev.ip.startsWith('127.') || dev.ip.startsWith('10.89.')) {
          continue;
        }

        console.log(`\n--- Analizando dispositivo -> IP: ${dev.ip} | MAC: ${dev.mac} ---`);
        let clasificacion = clasificarPorOUI(dev.mac);
        
        if (!clasificacion) {
          console.log(`[PIPELINE] OUI desconocido para ${dev.ip}. Activando puertos y web...`);
          clasificacion = await inferirTipoPorServicios(dev.ip);
        }

        if (!clasificacion) {
          console.log(`[PIPELINE] Filtros agotados para ${dev.ip}. Asignando genérico.`);
          clasificacion = { tipo: 'PC / Servidor / Otro', fabricante: 'Desconocido / Genérico' };
        }

        console.log(`[FINAL RESULT] IP: ${dev.ip} -> Tipo: ${clasificacion.tipo} | Fabricante: ${clasificacion.fabricante}`);
        dispositivosProcesados.push({ ...dev, ...clasificacion });
      }

      console.log(`\n[DEBUG] Escaneo completado. Total procesados: ${dispositivosProcesados.length}`);
      resolve(dispositivosProcesados);
    });
  });
}

let autenticado = false;

async function asegurarAutenticacion() {
  if (autenticado && pb.authStore.isValid) return true;
  try {
    console.log('[DEBUG] Autenticando en PocketBase...');
    await pb.collection('_superusers').authWithPassword(PB_ADMIN_EMAIL, PB_ADMIN_PASS);
    autenticado = true;
    console.log('[AUTENTICACIÓN] ¡Exitosa!');
    return true;
  } catch (authErr) {
    console.error('[AUTH ERROR]:', authErr.message);
    autenticado = false;
    return false;
  }
}

async function cicloShadowIT() {
  if (!PB_ADMIN_EMAIL || !PB_ADMIN_PASS) {
    setTimeout(cicloShadowIT, 10000);
    return;
  }

  const ok = await asegurarAutenticacion();
  if (!ok) {
    setTimeout(cicloShadowIT, 10000);
    return;
  }

  try {
    const redDetectada = await escanearRedNmap();
    const activosOficiales = await pb.collection('activos').getFullList();
    const macsOficiales = new Set(activosOficiales.map(a => a.mac?.toLowerCase()));

    let nuevosDispositivosEncontrados = 0;

    for (const dev of redDetectada) {
      if (!dev.mac) continue;

      if (!macsOficiales.has(dev.mac)) {
        if (!macsVistasEnMemoria.has(dev.mac)) {
          macsVistasEnMemoria.add(dev.mac);
          nuevosDispositivosEncontrados++;

          const existeShadow = await pb.collection('shadow_it').getList(1, 1, {
            filter: `mac_detectada = "${dev.mac}"`
          });

          if (existeShadow.items.length === 0) {
            await pb.collection('shadow_it').create({
              ip_detectada: dev.ip,
              mac_detectada: dev.mac,
              tipo_sugerido: dev.tipo,
              fabricante: dev.fabricante,
              estado: 'Cuarentena'
            });
            console.log(`[DB SAVED] Creado en BD -> IP: ${dev.ip} | Tipo: ${dev.tipo}`);
          }
        }
      }
    }

    if (nuevosDispositivosEncontrados === 0) {
      process.stdout.write(".");
    }

  } catch (err) {
    console.error('[CICLO ERROR]', err.message);
    autenticado = false;
  }

  setTimeout(cicloShadowIT, 15000);
}

cicloShadowIT();