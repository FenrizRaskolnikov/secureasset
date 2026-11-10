# Esquema de Base de Datos PocketBase - SecurAsset

Este documento describe la estructura **oficial y exacta** de colecciones, campos, tipos de datos, valores permitidos y relaciones del proyecto **SecurAsset** en PocketBase. Sirve como guía de reconstrucción o respaldo técnico en caso de reinstalación desde cero o migración de servidor.

## 1. Mapa de Colecciones (Estructura de Tablas)

El sistema SecurAsset utiliza 5 colecciones en PocketBase:

```
+-----------------------------------------------------------------------------------+
|                                 POCKETBASE DB                                     |
+-------------+-------------+------------------------+------------------+-----------+
|    users    |   activos   | evaluaciones_endpoints | evaluaciones_red | shadow_it |
|   (Auth)    |   (Base)    |         (Base)         |      (Base)      |  (Base)   |
+-------------+-------------+------------------------+------------------+-----------+

```

## 2. Detalle Campos y Especificaciones por Colección

### 2.1. Colección: `users` (Autenticación / Auth)

Gestión de cuentas de administradores, usuarios de consulta y agentes workers.

* **Tipo de Colección:** Auth Collection

| Campo | Tipo PocketBase | Requerido | Descripción / Valores | 
| ----- | ----- | ----- | ----- | 
| `id` | System (Text) | Sí | Identificador único de PocketBase (15 caracteres) | 
| `email` | Email | Sí | Correo electrónico de acceso | 
| `emailVisibility` | Bool | No | Visibilidad pública del correo | 
| `verified` | Bool | No | Estado de verificación del email (`True`/`False`) | 
| `name` | Text | No | Nombre visible del usuario o agente | 
| `avatar` | File | No | Imagen de avatar del perfil | 
| `role` | Select | Sí | Roles del sistema: `user`, `admin`, `service_agent` | 

### 2.2. Colección: `activos` (Inventario Principal)

Almacena el registro centralizado de dispositivos autorizados y evaluados de la red corporativa.

* **Tipo de Colección:** Base Collection

| Campo | Tipo PocketBase | Requerido | Descripción / Valores | 
| ----- | ----- | ----- | ----- | 
| `id` | System (Text) | Sí | ID del registro (PK) | 
| `hostname` | Text | Sí | Nombre del equipo en la red (ej: `PC-192-168-10-29`) | 
| `ip` | Text | Sí | Dirección IP asignada (ej: `192.168.10.29`) | 
| `mac` | Text | Sí | Dirección MAC del dispositivo (ej: `14:dd:a9:81:14:79`) | 
| `tipo` | Select | Sí | Opciones de tipo: `PC`, Servidor, `NVR`, `Otros` | 
| `ubicacion` | Text | No | Sede o sucursal asociada (ej: `Sede Central`) | 
| `responsable` | Text | No | Persona o método de asignación (ej: `Asignado Manualmente`) | 
| `estado_ciclo` | Select | Sí | Estados del ciclo de vida: `Operativo`, `Mantenimiento`, `Baja`, `Cuarentena` | 
| `score_seguridad` | Number | No | Calificación numérica de postura de seguridad (0 - 100) | 
| `n_serie` | Text | No | Número de serie o identificador derivado (ej: `SN-14DDA9811479`) | 
| `forzar_escaneo_manual` | Text / Bool | No | Flag para activar re-escaneo a solicitud del admin (`true`/`false`/`N/A`) | 

### 2.3. Colección: `evaluaciones_endpoints` (Auditoría Local / Agente Python)

Guarda la información técnica y de postura de seguridad reportada por el agente Python en estaciones de trabajo/servidores.

* **Tipo de Colección:** Base Collection

| Campo | Tipo PocketBase | Requerido | Descripción / Valores | 
| ----- | ----- | ----- | ----- | 
| `id` | System (Text) | Sí | ID de evaluación | 
| `relation` | Relation | Sí | Relación (Single) hacia la colección `activos` | 
| `bitlocker_activo` | Bool | No | Estado de cifrado BitLocker (`True`/`False`) | 
| `edr_activo` | Bool | No | Presencia de antivirus/EDR (`True`/`False`) | 
| `edr_version` | Text | No | Nombre/versión del EDR (ej: `Windows Defender Real-time`, `Linux Security Process`) | 
| `parches_so_al_dia` | Bool | No | Verificación de actualización del SO (`True`/`False`) | 
| `fecha_ultimo_parche` | Text | No | Fecha reportada de último parche instalado (ej: `2026-10-21`) | 
| `admin_locales` | Text | No | Lista o usuario administrador local (ej: `Administrador, jeste`, `root`) | 
| `cpu` | Text | No | Modelo de procesador (ej: `12th Gen Intel(R) Core(TM) i5-12450HX`) | 
| `ram` | Text | No | Memoria RAM total (ej: `16 GB`, `7 GB`) | 
| `disco` | Text | No | Almacenamiento detectado (ej: `475 GB SSD`, `146G (Host SSD/HDD)`) | 

### 2.4. Colección: `evaluaciones_red` (Auditoría de Red / Workers Node.js)

Almacena el resultado del escaneo de puertos, servicios expuestos y análisis de firmas en NVRs, servidores y dispositivos de red.

* **Tipo de Colección:** Base Collection

| Campo | Tipo PocketBase | Requerido | Descripción / Valores | 
| ----- | ----- | ----- | ----- | 
| `id` | System (Text) | Sí | ID del reporte de red | 
| `relation` | Relation | No | Relación opcional hacia la colección `activos` | 
| `host_asociado` | Text | No | Hostname escaneado | 
| `ip_asociada` | Text | No | Dirección IP auditada | 
| `puertos_abiertos` | JSON / Array | No | Arreglo de puertos TCP detectados (ej: `["80", "554"]`) | 
| `vulnerabilidades` | JSON / Array | No | Diagnóstico de vulnerabilidades (ej: `["Sin vulnerabilidades críticas detectadas"]`) | 
| `firmware` | Text | No | Estado de firmware o cabecera web (ej: `Protegido / Cabecera Omitida (Hardened)`, `Pendiente de escaneo`) | 

### 2.5. Colección: `shadow_it` (Descubrimiento y Cuarentena)

Registra los dispositivos desconocidos o no autorizados detectados en la red corporativa mediante escaneos ARP/Nmap.

* **Tipo de Colección:** Base Collection

| Campo | Tipo PocketBase | Requerido | Descripción / Valores | 
| ----- | ----- | ----- | ----- | 
| `id` | System (Text) | Sí | ID del hallazgo | 
| `mac_detectada` | Text | Sí | Dirección MAC capturada en red (ej: `e4:24:6c:9b:1b:08`) | 
| `ip_detectada` | Text | No | IP temporal detectada (ej: `192.168.10.151`) | 
| `tipo_sugerido` | Text | No | Tipo inferido por puertos/SMB/OUI (ej: `NVR`, `PC`, `Impresora`, `PC / Servidor / Otro`) | 
| `fabricante` | Text | No | Descripción inferida del fabricante (ej: `Cámara / NVR (Inferido por Puertos)`, `Endpoint Windows (Inferido por SMB)`) | 
| `fecha_de_deteccion` | Date / DateTime | No | Fecha y hora en que fue detectado en la red | 
| `estado` | Select | Sí | Estado del hallazgo: `Cuarentena`, `Aprobado`, `Ignorado` | 

## 3. Relaciones entre Colecciones

```
                   +------------------------+
                   |        activos         |
                   +------------------------+
                   | id (PK)                |
                   | hostname               |
                   | mac                    |
                   +-----------+------------+
                               |
               +---------------+---------------+
               | 1                             | 1
               |                               |
               | N                             | N
+--------------v-------------+  +--------------v-------------+
|   evaluaciones_endpoints   |  |      evaluaciones_red      |
+----------------------------+  +----------------------------+
| id (PK)                    |  | id (PK)                    |
| relation (FK -> activos)   |  | relation (FK -> activos)   |
| bitlocker_activo           |  | host_asociado              |
| edr_activo                 |  | puertos_abiertos           |
| cpu, ram, disco            |  | vulnerabilidades           |
+----------------------------+  +----------------------------+

```

## 4. Respaldos y Exportación desde PocketBase

Para garantizar la integridad del esquema en Git sin subir datos sensibles:

1. Ingrese a **PocketBase Admin Panel** (`http://192.168.10.8:8095/_/`).

2. Diríjase a **Settings** → **Export collections**.

3. Guarde el archivo generado **`pb_schema.json`** en el repositorio bajo la ruta `./pb_data/pb_schema.json`.

4. Si necesita restaurar en un servidor limpio, vaya a **Settings** → **Import collections** y cargue este archivo `pb_schema.json`.