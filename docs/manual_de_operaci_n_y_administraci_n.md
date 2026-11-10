# Manual de Operación y Administración
## Sistema Integrado de Gestión de Activos y Ciberseguridad SecurAsset
**GRUPO ANTUMALAL**

---

### Enlaces y Accesos al Sistema

- **DASHBOARD PRINCIPAL (FRONTEND SVELTEKIT):** `http://192.168.10.8:9080/`
- **PANEL ADMIN BASE DE DATOS (POCKETBASE):** `http://192.168.10.8:8095/_/`

---

## 1. Introducción y Arquitectura del Sistema

SecurAsset (SecureInventory) es un sistema automatizado de gestión de activos de red, auditoría de endpoints y control de postura de ciberseguridad corporativa. Su arquitectura se compone de los siguientes servicios desacoplados desplegados mediante **Podman Compose** o **Docker Compose**:

| Contenedor / Servicio | Puerto / Protocolo | Función Principal y Descripción |
| :--- | :--- | :--- |
| `secureinventory-pb` | `8095/TCP` | Base de datos backend ligera basada en PocketBase. Almacena el inventario de activos, evaluaciones y configuraciones. |
| `secureinventory-frontend` | `9080/TCP` | Interfaz web interactiva para usuarios y administradores desarrollada en SvelteKit / Bulma CSS. |
| `secureinventory-worker-network` | Interno | Worker en Node.js encargado del descubrimiento de red (ARP/Nmap) y detección de Shadow IT. |
| `secureinventory-worker-audit` | Interno | Worker en Node.js para auditoría remota de puertos, firmware y contraseñas por defecto en NVRs y servidores. |
| `secureinventory-agente-python` | Host / Agente | Agente local en Python ejecutado en endpoints para reportar BitLocker, EDR, parches y hardware. |

---

## 2. Instalación y Configuración del Entorno de Ejecución

El sistema puede desplegarse indistintamente utilizando **Podman Compose** (modo rootless recomendado por seguridad) o **Docker Engine / Docker Compose**. Seleccione la alternativa correspondiente a la infraestructura de su servidor:

### Opción A: Instalación con Podman & Podman Compose (Recomendado)

En el servidor Linux (RHEL / AlmaLinux / Rocky Linux / Ubuntu Server), instale el motor Podman y active la persistencia de usuario:

```bash
# En RHEL / Rocky Linux / AlmaLinux / Fedora:
sudo dnf install -y podman podman-compose netavark aardvark-dns git

# En Ubuntu Server / Debian:
sudo apt update && sudo apt install -y podman podman-compose git

# Habilitar persistencia de procesos del usuario (lingering) y socket Podman
sudo loginctl enable-linger $USER
systemctl --user enable --now podman.socket
```

### Opción B: Instalación con Docker Engine & Docker Compose

Si prefiere utilizar el motor Docker oficial en su servidor Linux, ejecute la instalación del motor y el plugin de Compose:

```bash
# En Ubuntu Server / Debian:
sudo apt update && sudo apt install -y ca-certificates curl gnupg git
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update && sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Agregar el usuario actual al grupo docker (para ejecutar sin sudo)
sudo usermod -aG docker $USER
newgrp docker
```

---

## 3. Despliegue Inicial del Sistema

Siga estos pasos para obtener el código fuente, configurar el entorno y orquestar la pila de contenedores:

### 3.1. Obtención del Código y Configuración del Archivo .env

Acceda al directorio raíz del proyecto SecurAsset y cree/configure el archivo de entorno `.env` principal con la estructura de variables requerida por los servicios:

```bash
# 1. Acceder al directorio del proyecto
cd /ruta/al/proyecto/securasset

# 2. Crear o editar el archivo .env principal
nano .env
```

Escriba la siguiente estructura en el archivo `.env` asignando las direcciones IP y credenciales correspondientes a su entorno:

```env
# URL Pública de PocketBase accesible desde el navegador/frontend
PUBLIC_POCKETBASE_URL=http://<IP_DEL_SERVIDOR>:8095
VITE_POCKETBASE_URL=http://<IP_DEL_SERVIDOR>:8095

# URL Interna de PocketBase para comunicación entre contenedores/agentes
PUBLIC_POCKETBASE_INTERNAL_URL=http://127.0.0.1:8095

# Credenciales de Administrador / Superusuario para Workers y API
PB_ADMIN_EMAIL=admin_securasset@tu-dominio.com
PB_ADMIN_PASS=<TU_CONTRASENA_SUPERUSUARIO_SEGURA>

# Credenciales de Agente Worker para autenticación de endpoints
AGENT_USER=agente_worker@tu-dominio.com
AGENT_PASS=<TU_CONTRASENA_WORKER_SEGURA>
```

### 3.2. Construcción y Puesta en Marcha

1. Verifique que el archivo de entorno `.env` contenga todas las variables anteriores configuradas correctamente.
2. Construya e inicie todos los servicios en segundo plano utilizando la herramienta seleccionada:
   ```bash
   # Si utiliza Podman Compose:
   podman compose up -d --build

   # Si utiliza Docker Compose:
   docker compose up -d --build
   ```
3. **Verificación:** Confirme que todos los contenedores se encuentren en estado activo (`Up`):
   ```bash
   # En Podman:
   podman ps

   # En Docker:
   docker ps
   ```

> **Estado Esperado de la Infraestructura:** Los contenedores principales deben figurar en estado *Up About an hour* o similar, exponiendo los puertos `8095` (PocketBase) y `9080` (Dashboard Frontend).

---

## 4. Gestión y Cambio de Credenciales

Para mantener la postura de seguridad, es fundamental sincronizar las credenciales entre la base de datos central, los workers de auditoría y los agentes en los endpoints.

### 4.1. Cambio de Credenciales de Superusuario (PocketBase)

Las credenciales del superusuario permiten a los workers de Node.js autenticarse mediante API JWT para registrar los escaneos de red:

1. Modifique las variables en el archivo `.env` principal (raíz del proyecto):
   ```env
   PB_ADMIN_EMAIL=nuevo_admin@antumalal.com
   PB_ADMIN_PASS=TuNuevaContrasenaSegura2026!
   ```
2. Actualice las mismas variables en el bloque `environment` del archivo `docker-compose.yml` para los servicios de workers.
3. Reinicie los contenedores para aplicar los cambios de entorno:
   ```bash
   podman compose down && podman compose up -d --build
   ```

### 4.2. Cambio de Credenciales del Agente Worker (Conexión Endpoint Windows/Linux)

El agente Python instalado en las estaciones de trabajo utiliza su propio archivo `.env` local para autenticarse con la colección `users` de PocketBase. En caso de modificar el usuario o la clave del agente, siga este procedimiento:

1. **Detener el proceso activo del agente:** Forzar el cierre del ejecutable en la estación de trabajo para evitar bloqueos del archivo de configuración o sesiones rechazadas:
   ```cmd
   taskkill /f /im agente.exe 2>nul
   ```
2. **Actualizar la configuración local (.env):** Abra el archivo de entorno (ubicado habitualmente en `C:\ProgramData\SecureInventory\.env` o en el directorio raíz del script) y actualice los parámetros:
   ```env
   PUBLIC_POCKETBASE_URL=http://192.168.10.8:8095
   AGENT_USER=worker_endpoint@antumalal.com
   AGENT_PASS=ClaveSeguraWorker2026!
   ```
   > **Nota:** Verifique que no queden espacios adicionales al final de cada valor.

3. **Reiniciar la Tarea Programada / Servicio:** Reinicie el binario `agente.exe` mediante el Administrador de Tareas Programadas de Windows (registrado como `SecureInventoryAgent`).
4. **Verificación:** Confirme en los registros del sistema que el proceso `agente.exe` se ejecute de manera estable y conecte correctamente al endpoint configurado.

---

## 5. Manual de Usuario (Operación del Dashboard)

El dashboard de SecurAsset ofrece a los administradores de TI una vista centralizada en tiempo real de la postura de ciberseguridad e inventario corporativo.

### 5.1. Inicio de Sesión y Control de Acceso

- **Acceso Web:** Ingrese a la dirección oficial `http://192.168.10.8:9080/` para abrir la pantalla de autenticación (`LoginView`).
- **Roles de Usuario:**
  - **Administrador (`admin`):** Privilegios totales para aprobar dispositivos Shadow IT, editar fichas técnicas, gestionar sedes/sucursales y forzar re-escaneos o auditorías en tiempo real.
  - **Operador / Consulta:** Acceso de lectura al inventario, fichas técnicas, actas PDF y reportes de seguridad.

### 5.2. Barra de Navegación Superior y Selector de Sede

- **Selector de Sede:** Permite filtrar el inventario por sucursales (*Todas las sedes, Sede Central, Sucursal Norte, Sucursal Sur, Bodega Central*).
- **Gestión de Sedes:** (Solo Admin) Modal interactivo (`SedeModal`) para añadir o eliminar sedes, validando que no existan activos asignados antes de borrar.
- **Sincronización Manual:** Fuerza la actualización inmediata de registros e indicadores desde PocketBase.

### 5.3. Panel de Indicadores Globales (KPIs de Seguridad)

Ubicado en la parte superior (`StatsLevel`), resume la salud de la infraestructura en 4 tarjetas:

- **Total Activos:** Suma de dispositivos oficiales clasificados por tipo (PCs, Servidores, NVRs, Otros).
- **Score Promedio:** Calificación general corporativa (Verde $\ge 80$, Amarillo $50-79$, Rojo $< 50$).
- **Equipos en Riesgo:** Conteo crítico de dispositivos con score inferior a 50 puntos.
- **Shadow IT / Cuarentena:** Equipos no autorizados detectados mediante análisis de MAC/OUI.

### 5.4. Navegación Principal y Filtros Laterales

- **Vista Dashboard:** Resumen interactivo con tarjetas rojas (Críticos), amarillas (Medio) y grises (Shadow IT).
- **Vista Inventario:** Tabla paginada (`InventoryTable`) con búsqueda por Hostname, IP, MAC o responsable.
- **Filtros Rápidos:** Acceso directo a categorías por tipo y estado de riesgo.

### 5.5. Operación por Modales de Detalle

- **Ficha PCs (`DetailModal`):** Especificaciones de hardware, estado de BitLocker/LUKS, EDR, parches y botón de Re-escanear PC. Permite generar la etiqueta QR y el Acta PDF de Entrega/Devolución.
- **Ficha Servidores/NVRs (`ServerNvrModal`):** Auditoría de red, detección de passwords por defecto, puertos abiertos y firmas de firmware.
- **Shadow IT (`ShadowITModal`):** Evaluación de dispositivos en cuarentena y botón *"Aprobar y Pasar a Activo"*.

### 5.6. Verificación Externa mediante Códigos QR

Al escanear la etiqueta física de un activo, el sistema redirige a la ruta pública (`/?ver=ID` / `routes/qr`), permitiendo verificar la ficha técnica y generar actas PDF inmutables en terreno sin necesidad de iniciar sesión previa.