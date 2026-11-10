# SecurAsset (SecureInventory)

Sistema automatizado de gestión de activos de red, auditoría de endpoints y control de postura de ciberseguridad corporativa.

## Estructura y Enlaces Clave del Repositorio

Para operar, desplegar y auditar el sistema correctamente, revisa los siguientes recursos integrados en el repositorio:

* [**`/docs`**](./docs): Carpeta que contiene la documentación oficial, incluyendo el *Manual de Operación y Administración* en formato PDF y Markdown, esquemas de bases de datos PocketBase y especificaciones técnicas.

* [**`/installer`**](./installer): Carpeta que contiene el archivo comprimido **`SecureInventory-Agente-Deploy.zip`**, el cual incluye el kit de instalación del agente en Python (`agente.py`) para su despliegue y configuración automática en los equipos o endpoints de la red.

## Arquitectura del Sistema

SecurAsset opera mediante servicios desacoplados orquestados por contenedores:

| Contenedor / Servicio | Puerto / Protocolo | Función Principal | 
| ----- | ----- | ----- | 
| **`secureinventory-pb`** | `8095/TCP` | Base de datos backend (PocketBase) para inventario y configuraciones. | 
| **`secureinventory-frontend`** | `9080/TCP` | Interfaz web interactiva (SvelteKit / Bulma CSS). | 
| **`secureinventory-worker-network`** | Red Interna / Host | Descubrimiento de red (ARP/Nmap) y detección de Shadow IT. | 
| **`secureinventory-worker-audit`** | Red Interna / Host | Auditoría de puertos abiertos, firmware y credenciales por defecto. | 
| **`secureinventory-agente-python`** | Host / Agente | Agente local ejecutado en endpoints para reportar BitLocker, EDR, parches y hardware. | 

## Despliegue del Sistema

### 1. Configuración del Archivo de Entorno (`.env`)

Cree el archivo `.env` en la raíz del proyecto (o use como plantilla el archivo de configuración) asignando las IP y credenciales del servidor:

```env
# URL Pública de PocketBase accesible desde el navegador/frontend
PUBLIC_POCKETBASE_URL=http://<IP_DEL_SERVIDOR>:8095
VITE_POCKETBASE_URL=http://<IP_DEL_SERVIDOR>:8095

# URL Interna de PocketBase para comunicación entre contenedores y agentes
PUBLIC_POCKETBASE_INTERNAL_URL=http://127.0.0.1:8095

# Credenciales de Administrador / Superusuario para Workers y API
PB_ADMIN_EMAIL=tu_admin@dominio.com
PB_ADMIN_PASS=tu_contrasena_segura

# Credenciales de Agente Worker para autenticación de endpoints
AGENT_USER=agente_worker@dominio.com
AGENT_PASS=tu_clave_worker
```

### 2. Puesta en Marcha con Contenedores

Puedes levantar la infraestructura utilizando **Podman Compose** (recomendado en modo *rootless*) o **Docker Compose**:

#### Opción A: Despliegue mediante Podman Compose

```bash
# 1. Construir e iniciar los contenedores en segundo plano
podman compose up -d --build

# 2. Verificación del estado de los contenedores
podman ps
```

#### Opción B: Despliegue mediante Docker Compose

```bash
# 1. Construir e iniciar los contenedores en segundo plano
docker compose up -d --build

# 2. Verificación del estado de los contenedores
docker ps
```

### 3. Verificación del Estado y Acceso a la Plataforma

Una vez ejecutados los contenedores en segundo plano:

* **Dashboard Principal (Frontend SvelteKit):** `http://<IP_DEL_SERVIDOR>:9080/`
* **Panel de Administración de Base de Datos (PocketBase):** `http://<IP_DEL_SERVIDOR>:8095/_/`

---

## Documentación Adicional

Consulta los manuales completos dentro de la ruta [`/docs`](./docs) para procedimientos avanzados de cambio de credenciales, gestión de sedes, políticas de seguridad y la guía de despliegue del agente de Windows.
