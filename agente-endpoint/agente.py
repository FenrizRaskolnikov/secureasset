import os
import platform
import subprocess
import socket
import requests
import re
import time
import json
import threading
from pathlib import Path
from dotenv import load_dotenv

# Carga explícita y segura del archivo .env ubicado en la raíz del proyecto
env_path = Path(__file__).resolve().parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

PB_URL = (os.getenv("PUBLIC_POCKETBASE_INTERNAL_URL") or os.getenv("PUBLIC_POCKETBASE_URL") or "http://192.168.10.8:8090").rstrip('/')
AGENT_USER = os.getenv("AGENT_USER", "").strip()
AGENT_PASS = os.getenv("AGENT_PASS", "").strip()

print(f"[DEBUG] PB_URL leída: {PB_URL}")
print(f"[DEBUG] AGENT_USER leído: {AGENT_USER}")
print(f"[DEBUG] AGENT_PASS leído: {'*' * len(AGENT_PASS)}")

OS_TYPE = platform.system()  # 'Windows' o 'Linux'

def obtener_token_agente():
    """Autentica contra la colección de usuarios para obtener el token JWT."""
    print("[AUTENTICACIÓN] Solicitando token de acceso en PocketBase...")
    try:
        url = f"{PB_URL}/api/collections/users/auth-with-password"
        payload = {"identity": AGENT_USER, "password": AGENT_PASS}
        res = requests.post(url, json=payload, timeout=5)
        if res.status_code == 200:
            print("[AUTENTICACIÓN] ¡Token obtenido exitosamente!")
            return res.json().get("token")
        else:
            print(f"[AUTENTICACIÓN ERROR] HTTP {res.status_code}: {res.text}")
    except Exception as e:
        print(f"[AUTENTICACIÓN EXCEPCIÓN] No se pudo conectar para autenticar: {e}")
    return None

def ejecutar_cmd(cmd):
    """Ejecuta comandos del sistema de forma segura según el Sistema Operativo."""
    try:
        if OS_TYPE == "Windows":
            res = subprocess.check_output(["powershell", "-Command", cmd], text=True, stderr=subprocess.DEVNULL)
        else:
            res = subprocess.check_output(cmd, shell=True, text=True, stderr=subprocess.DEVNULL)
        return res.strip()
    except Exception:
        return ""

def obtener_ip_local():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

def obtener_mac_address():
    mac = "00:00:00:00:00:00"
    if OS_TYPE == "Windows":
        cmd = "Get-CimInstance Win32_NetworkAdapterConfiguration -Filter \"IPEnabled = 'True'\" | Select-Object -ExpandProperty MACAddress | Select-Object -First 1"
        res = ejecutar_cmd(cmd)
        if res:
            mac = res
    else:
        try:
            for iface_dir in Path('/sys/class/net').iterdir():
                iface = iface_dir.name
                if iface in ['lo', 'docker0', 'podman0'] or iface.startswith('veth') or iface.startswith('br-'):
                    continue
                addr_file = iface_dir / 'address'
                if addr_file.exists():
                    contenido = addr_file.read_text().strip()
                    if contenido and contenido != "00:00:00:00:00:00":
                        mac = contenido
                        break
        except Exception:
            pass

        if mac == "00:00:00:00:00:00":
            res = ejecutar_cmd("ip -o link show | awk -F': ' '$2 !~ /lo|docker|veth|br-/ {print $2}' | head -n 1")
            if res:
                mac_raw = ejecutar_cmd(f"cat /sys/class/net/{res}/address 2>/dev/null")
                if mac_raw:
                    mac = mac_raw

    return mac.lower().replace('-', ':')

def obtener_numero_serie():
    if OS_TYPE == "Windows":
        cmd = "(Get-WmiObject win32_bios).SerialNumber.Trim()"
        res = ejecutar_cmd(cmd)
        return res if res else "SN-UNKNOWN"
    else:
        res = ""
        try:
            serial_path = Path('/sys/class/dmi/id/product_serial')
            if serial_path.exists():
                res = serial_path.read_text().strip()
        except Exception:
            pass

        if not res or res.lower() in ["none", "unknown", "n/a"]:
            res = ejecutar_cmd("sudo dmidecode -s system-serial-number 2>/dev/null")
            
        return res if res else "SN-LINUX-HOST"

# --- REQUERIMIENTOS DE EVALUACIÓN ---

def verificar_bitlocker():
    if OS_TYPE == "Windows":
        cmd = "Get-BitLockerVolume -MountPoint 'C:' | Select-Object -ExpandProperty ProtectionStatus"
        res = ejecutar_cmd(cmd)
        return "On" in res or "ProtectionOn" in res
    else:
        res = ejecutar_cmd("lsblk -o TYPE,FSTYPE | grep -iE 'crypt|crypto_LUKS'")
        return bool(res)

def verificar_edr():
    if OS_TYPE == "Windows":
        cmd = "Get-Service | Where-Object {$_.Name -match 'WinDefend|CSFalconService|SentinelAgent|CortexXDR|CarbonBlack'} | Where-Object {$_.Status -eq 'Running'}"
        res = ejecutar_cmd(cmd)
        if res:
            return True
        
        cmd_wmi = "Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntivirusProduct | Select-Object -ExpandProperty displayName"
        res_wmi = ejecutar_cmd(cmd_wmi)
        return bool(res_wmi)
    else:
        cmd = "ps aux | grep -iE '(crowdstrike|falcon|sentinel|clamav|wazuh|ossec|cortex)' | grep -v grep"
        res = ejecutar_cmd(cmd)
        return bool(res)

def verificar_parches_so():
    if OS_TYPE == "Windows":
        cmd = """
        $ultimoParche = (Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 1).InstalledOn
        if ($ultimoParche) {
            $dias = (New-TimeSpan -Start $ultimoParche -End (Get-Date)).Days
            Write-Output $dias
        } else {
            Write-Output 999
        }
        """
        res = ejecutar_cmd(cmd)
        dias_sin_parchar = int(res) if res.isdigit() else 999
        return dias_sin_parchar <= 60
    else:
        if os.path.exists("/usr/bin/apt") or os.path.exists("/bin/apt"):
            res = ejecutar_cmd("apt list --upgradable 2>/dev/null | wc -l")
            pendientes = (int(res) - 1) if (res.isdigit() and int(res) > 0) else 0
            return pendientes == 0
        elif os.path.exists("/usr/bin/dnf") or os.path.exists("/bin/dnf"):
            res = ejecutar_cmd("dnf check-update -q | grep -v '^ *$' | wc -l")
            pendientes = int(res) if res.isdigit() else 0
            return pendientes == 0
        return True

def obtener_fecha_ultimo_parche():
    if OS_TYPE == "Windows":
        cmd = "(Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 1).InstalledOn.ToString('yyyy-MM-dd')"
        res = ejecutar_cmd(cmd)
        return res if res else "1970-01-01"
    else:
        try:
            with open("/var/log/apt/history.log", "r") as f:
                for linea in reversed(f.readlines()):
                    if "End-Date:" in linea:
                        match = re.search(r'\d{4}-\d{2}-\d{2}', linea)
                        if match:
                            return match.group(0)
        except Exception:
            pass
        
        try:
            res_rpm = ejecutar_cmd("rpm -qa --last | head -n 1")
            if res_rpm:
                match_fecha = re.search(r'(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+([A-Za-z]{3}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})', res_rpm)
                if match_fecha:
                    from datetime import datetime
                    dt = datetime.strptime(match_fecha.group(2), "%b %d %H:%M:%S %Y")
                    return dt.strftime("%Y-%m-%d")
        except Exception:
            pass

        return "1970-01-01"

def obtener_specs_hardware():
    if OS_TYPE == "Windows":
        cmd_cpu = "(Get-WmiObject Win32_Processor).Name.Trim()"
        cpu = ejecutar_cmd(cmd_cpu)
        
        cmd_ram = "[math]::round((Get-WmiObject Win32_ComputerSystem).TotalPhysicalMemory / 1GB)"
        ram_gb = ejecutar_cmd(cmd_ram)
        ram = f"{ram_gb} GB" if ram_gb else "Desconocido"
        
        cmd_disco = """
        $ErrorActionPreference = 'SilentlyContinue'
        $discoC = Get-Partition -DriveLetter C | Get-Disk
        $tipo = (Get-PhysicalDisk | Where-Object DeviceId -eq $discoC.Number).MediaType
        $bus = (Get-PhysicalDisk | Where-Object DeviceId -eq $discoC.Number).BusType
        $tamanoGB = [math]::round((Get-Volume -DriveLetter C).Size / 1GB)

        if ($bus -eq 'NVMe' -or $tipo -eq 'SSD') {
            $tecnologia = "SSD"
        } elseif ($tipo -eq 'HDD') {
            $tecnologia = "HDD"
        } else {
            $tecnologia = "SSD"
        }

        "$tamanoGB GB $tecnologia"
        """
        disco = ejecutar_cmd(cmd_disco)
        return (cpu or "Desconocido"), ram, (disco or "Desconocido")
    else:
        cpu = ejecutar_cmd("LC_ALL=C grep -m1 'model name' /proc/cpuinfo | cut -d: -f2").strip()
        if not cpu:
            cpu = ejecutar_cmd("LC_ALL=C lscpu | grep 'Model name' | cut -d: -f2").strip()
        
        ram = "Desconocido"
        try:
            with open('/proc/meminfo', 'r') as f:
                for line in f:
                    if 'MemTotal' in line:
                        mem_kb = int(line.split()[1])
                        ram_gb = round(mem_kb / (1024 * 1024))
                        ram = f"{ram_gb} GB"
                        break
        except Exception:
            ram_mb = ejecutar_cmd("LC_ALL=C free -m | awk '/^Mem:/ {print $2}'")
            if ram_mb.isdigit():
                ram = f"{round(int(ram_mb)/1024)} GB"
            
        disco = ejecutar_cmd("lsblk -d -o SIZE -n /dev/sd* 2>/dev/null | head -n 1").strip()
        if not disco:
            disco = ejecutar_cmd("lsblk -d -o SIZE -n /dev/nvme* 2>/dev/null | head -n 1").strip()
        if not disco:
            disco = ejecutar_cmd("LC_ALL=C df -h / | awk 'NR==2 {print $2}'").strip()
        
        disco = f"{disco} (Host SSD/HDD)" if disco else "Desconocido"
            
        return (cpu or "Linux CPU"), ram, disco

def obtener_administradores_locales():
    if OS_TYPE == "Windows":
        cmd = "(Get-LocalGroupMember -Group 'Administradores').Name"
        res = ejecutar_cmd(cmd)
        if res:
            return [line.strip().split('\\')[-1] for line in res.splitlines() if line.strip()]
        return []
    else:
        admins = []
        try:
            res_wheel = ejecutar_cmd("getent group wheel | cut -d: -f4")
            if not res_wheel:
                res_wheel = ejecutar_cmd("getent group sudo | cut -d: -f4")
            
            if res_wheel:
                admins = [u.strip() for u in res_wheel.split(',') if u.strip()]
            
            if not admins:
                with open('/etc/group', 'r') as f:
                    for line in f:
                        if line.startswith('wheel:') or line.startswith('sudo:'):
                            partes = line.strip().split(':')
                            if len(partes) >= 4 and partes[3]:
                                admins = [u.strip() for u in partes[3].split(',') if u.strip()]
        except Exception:
            pass

        if not admins:
            admins = ["root"]

        return admins

def calcular_score_seguridad(bitlocker, edr, parches_ok, cantidad_admins):
    score = 100
    if not bitlocker:
        score -= 25
    if not edr:
        score -= 35
    if not parches_ok:
        score -= 20
    if cantidad_admins > 3:
        score -= 20
    return max(0, score)

def calcular_score_servidor(parches_ok, cantidad_admins):
    """Ponderación justa y adaptada específicamente para Servidores."""
    score = 100
    if not parches_ok:
        score -= 30
    if cantidad_admins > 3:
        score -= 25
    return max(0, score)

def sincronizar_activo_y_evaluacion(forzado_manual=False):
    tipo_ciclo = "MANUAL FORZADO" if forzado_manual else "PROGRAMADO"
    print(f"\n[CICLO {tipo_ciclo}] Iniciando recolección de métricas del sistema local...")

    token = obtener_token_agente()
    if not token:
        print("[ERROR] No se pudo sincronizar debido a un fallo de autenticación.")
        return

    headers = {"Authorization": f"Bearer {token}"}
    hostname = platform.node()
    ip_local = obtener_ip_local()
    mac_address = obtener_mac_address()
    n_serie = obtener_numero_serie()
    
    bitlocker_ok = verificar_bitlocker()
    edr_ok = verificar_edr()
    parches_ok = verificar_parches_so()
    fecha_parche = obtener_fecha_ultimo_parche()
    admins_lista = obtener_administradores_locales()
    cantidad_admins = len(admins_lista)

    # 1. Verificar si el activo ya existe en PocketBase para extraer su tipo real (PC o Servidor)
    activo_id = None
    tipo_activo = os.getenv("AGENT_TYPE", "PC").strip().upper() # Valor por defecto si es nuevo

    try:
        url_activos = f"{PB_URL}/api/collections/activos/records"
        response = requests.get(url_activos, params={"filter": f"hostname='{hostname}'"}, headers=headers)
        
        if response.status_code == 200 and response.json().get("items"):
            item_existente = response.json()["items"][0]
            activo_id = item_existente["id"]
            tipo_activo = (item_existente.get("tipo") or "PC").strip().upper()
            print(f"[ACTIVOS] Activo existente encontrado (ID: {activo_id}). Tipo detectado en BD: {tipo_activo}")
    except Exception as e:
        print(f"[AVISO] No se pudo consultar el tipo previo del activo: {e}")

    # 2. Calcular el score dinámicamente según si es Servidor o PC de escritorio
    if tipo_activo == "SERVIDOR":
        score_real = calcular_score_servidor(parches_ok, cantidad_admins)
    else:
        score_real = calcular_score_seguridad(bitlocker_ok, edr_ok, parches_ok, cantidad_admins)

    print(f"[DATOS] Host: {hostname} | Tipo: {tipo_activo} | IP: {ip_local} | Score: {score_real}/100")

    vulnerabilidades_temp = []
    if tipo_activo == "SERVIDOR":
        if not parches_ok:
            vulnerabilidades_temp.append("Actualizaciones del sistema operativo pendientes en servidor")
        if cantidad_admins > 3:
            vulnerabilidades_temp.append(f"Exceso de cuentas con privilegios administrativos ({cantidad_admins})")
    else:
        if not bitlocker_ok:
            vulnerabilidades_temp.append("Cifrado de disco desactivado")
        if not edr_ok:
            vulnerabilidades_temp.append("Protección EDR / Antivirus inactiva o no detectada")
        if not parches_ok:
            vulnerabilidades_temp.append("Parches de seguridad del sistema operativo pendientes")
        if cantidad_admins > 3:
            vulnerabilidades_temp.append(f"Exceso de administradores locales ({cantidad_admins} detectados)")
    
    if not vulnerabilidades_temp:
        vulnerabilidades_temp.append("Sin vulnerabilidades críticas detectadas")

    # 3. Registrar o actualizar el activo en PocketBase
    try:
        if activo_id:
            res_patch = requests.patch(f"{PB_URL}/api/collections/activos/records/{activo_id}", json={
                "ip": ip_local, 
                "mac": mac_address,
                "n_serie": n_serie,
                "score_seguridad": score_real,
                "forzar_escaneo_manual": False
            }, headers=headers)
            if res_patch.status_code not in [200, 201]:
                print(f"[ERROR ACTUALIZANDO ACTIVO] HTTP {res_patch.status_code}: {res_patch.text}")
        else:
            print("[ACTIVOS] El activo no existe en la base de datos. Registrando nuevo...")
            payload_activo = {
                "hostname": hostname,
                "ip": ip_local,
                "mac": mac_address,
                "n_serie": n_serie,
                "tipo": tipo_activo,
                "estado_ciclo": "Operativo",
                "score_seguridad": score_real,
                "ubicacion": "Sede Central",
                "forzar_escaneo_manual": False
            }
            res_create = requests.post(url_activos, json=payload_activo, headers=headers)
            if res_create.status_code in [200, 201]:
                activo_id = res_create.json()["id"]
                print(f"[ACTIVOS] Activo creado con éxito (ID: {activo_id}).")
            else:
                print(f"[ERROR CREANDO ACTIVO] HTTP {res_create.status_code}: {res_create.text}")
    except Exception as e:
        print(f"[ERROR ACTIVOS] Ocurrió un error al gestionar el activo: {e}")
        return

    if not activo_id:
        print("[ERROR] No se pudo obtener el ID del activo.")
        return

    cpu, ram, disco = obtener_specs_hardware()
    payload_eval = {
        "relation": activo_id,
        "cpu": cpu,
        "ram": ram,
        "disco": disco,
        "bitlocker_activo": bitlocker_ok,
        "edr_activo": edr_ok,
        "edr_Version": "Windows Defender Real-time" if OS_TYPE == "Windows" else "Linux Security Process",
        "parches_so_al_dia": parches_ok,
        "fecha_ultimo_parche": fecha_parche,
        "admin_locales": ", ".join(admins_lista) if admins_lista else "Ninguno",
        "vulnerabilidades": json.dumps(vulnerabilidades_temp)
    }

    url_evaluaciones = f"{PB_URL}/api/collections/evaluaciones_endpoints/records"
    debe_guardar_eval = True

    if not forzado_manual:
        try:
            params_eval = {
                "filter": f"relation='{activo_id}'",
                "sort": "-created",
                "perPage": "1"
            }
            res_ult = requests.get(url_evaluaciones, params=params_eval, headers=headers)
            
            if res_ult.status_code == 200 and res_ult.json().get("items"):
                ultima_eval = res_ult.json()["items"][0]
                
                def norm_str(val):
                    return str(val or "").strip().lower()

                def norm_bool(val):
                    return str(val or "").strip().lower() in ['true', '1', 'yes', 't']

                cambios = []
                if norm_bool(ultima_eval.get("bitlocker_activo")) != bitlocker_ok: cambios.append("bitlocker")
                if norm_bool(ultima_eval.get("edr_activo")) != edr_ok: cambios.append("edr")
                if norm_bool(ultima_eval.get("parches_so_al_dia")) != parches_ok: cambios.append("parches")
                if norm_str(ultima_eval.get("fecha_ultimo_parche"))[:10] != norm_str(fecha_parche)[:10]: cambios.append("fecha")
                if norm_str(ultima_eval.get("admin_locales")) != norm_str(payload_eval["admin_locales"]): cambios.append("admins")
                if norm_str(ultima_eval.get("ram")) != norm_str(payload_eval["ram"]): cambios.append("ram")
                if norm_str(ultima_eval.get("cpu")) != norm_str(payload_eval["cpu"]): cambios.append("cpu")

                debe_guardar_eval = bool(cambios)
                if not debe_guardar_eval:
                    print("[EVALUACIÓN] No se detectaron cambios significativos. Omitiendo guardado de historial duplicado.")
        except Exception as e:
            print(f"[AVISO] No se pudo verificar la última evaluación previa: {e}")

    if debe_guardar_eval or forzado_manual:
        res_post = requests.post(url_evaluaciones, json=payload_eval, headers=headers)
        if res_post.status_code in [200, 201]:
            print(f"[ÉXITO] Nueva evaluación {'manual' if forzado_manual else 'por cambios'} registrada en PocketBase.")
        else:
            print(f"[ERROR] Al guardar evaluación: HTTP {res_post.status_code} - {res_post.text}")

def escuchar_tiempo_real():
    hostname = platform.node()
    print("[REALTIME] Hilo de escucha en tiempo real iniciado en segundo plano.")
    
    while True:
        token = obtener_token_agente()
        if not token:
            print("[REALTIME] Esperando token para reintentar conexión en 10 segundos...")
            time.sleep(10)
            continue

        try:
            headers = {"Authorization": f"Bearer {token}"}
            url_realtime = f"{PB_URL}/api/realtime"
            print(f"[REALTIME] Conectando al servicio SSE de PocketBase en {url_realtime}...")
            
            with requests.get(url_realtime, headers=headers, stream=True, timeout=300) as r:
                client_id = None
                for line in r.iter_lines():
                    if line:
                        decoded = line.decode('utf-8')
                        if decoded.startswith("data:"):
                            try:
                                data = json.loads(decoded[5:].strip())
                                if not client_id and "clientId" in data:
                                    client_id = data["clientId"]
                                    print(f"[REALTIME] Conectado exitosamente. ClientId asignado: {client_id}")
                                    sub_res = requests.post(url_realtime, json={"clientId": client_id, "subscriptions": ["activos"]}, headers=headers)
                                    print(f"[REALTIME] Suscrito al canal 'activos' (Status: {sub_res.status_code}). Esperando eventos...")

                                if "action" in data and data["action"] == "update" and "record" in data:
                                    record = data["record"]
                                    rec_hostname = record.get("hostname")
                                    flag = record.get("forzar_escaneo_manual")
                                    
                                    print(f"[REALTIME EVENTO] Activo actualizado: {rec_hostname} | Flag manual: {flag} ({type(flag)})")

                                    if rec_hostname == hostname:
                                        es_manual = flag is True or str(flag).lower() == "true"
                                        if es_manual:
                                            print(f"\n[¡ACTIVACIÓN MANUAL!] Petición detectada en tiempo real para este equipo ({hostname}).")
                                            sincronizar_activo_y_evaluacion(forzado_manual=True)
                            except json.JSONDecodeError:
                                pass
                            except Exception as ex:
                                print(f"[REALTIME ERROR PROCESANDO] {ex}")
        except Exception as e:
            print(f"[REALTIME DESCONEXIÓN] Conexión perdida o error de red: {e}. Reconectando en 5 segundos...")
            time.sleep(5)

def esperar_conexion_backend(url, max_intentos=10, espera_seg=3):
    print(f"[INICIO] Verificando conectividad con el backend PocketBase en {url}...")
    for intento in range(1, max_intentos + 1):
        try:
            res = requests.get(f"{url}/api/health", timeout=2)
            if res.status_code == 200:
                print("[INICIO] ¡Conexión con PocketBase establecida correctamente!")
                return True
        except Exception:
            pass
        print(f"[INICIO] Intento {intento}/{max_intentos}: Backend no disponible. Reintentando en {espera_seg}s...")
        time.sleep(espera_seg)
    return False

if __name__ == "__main__":
    print("==================================================")
    print("      INICIANDO AGENTE LOCAL DE SEGURIDAD         ")
    print("==================================================")
    
    if not esperar_conexion_backend(PB_URL):
        print("[FATAL] No se pudo establecer comunicación con el servidor PocketBase. Saliendo.")
        exit(1)
    
    hilo_realtime = threading.Thread(target=escuchar_tiempo_real, daemon=True)
    hilo_realtime.start()

    print("\n[PROGRAMADOR] El agente ejecutará un ciclo completo cada 5 minutos.")
    
    try:
        sincronizar_activo_y_evaluacion(forzado_manual=False)
    except Exception as e:
        print(f"[ERROR CICLO INICIAL] {e}")

    while True:
        time.sleep(300)
        try:
            sincronizar_activo_y_evaluacion(forzado_manual=False)
        except Exception as e:
            print(f"[ERROR CICLO PERIÓDICO] {e}")