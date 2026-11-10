<script lang="ts">
  import type { DispositivoShadowIT } from '../lib/types';

  let { 
    dispositivo = $bindable<any | null>(), 
    onGuardar, 
    onCerrar 
  }: { 
    dispositivo: any | null; 
    onGuardar?: (actualizado: any) => Promise<void> | void; 
    onCerrar: () => void; 
  } = $props();

  let estadoLocal = $state<any | null>(null);
  let cargando = $state(false); // Estado para prevenir múltiples clics y auto-cancelación

  $effect(() => {
    if (dispositivo) {
      estadoLocal = { ...dispositivo };
    } else {
      estadoLocal = null;
    }
  });

  let score = $derived(estadoLocal?.scoreSeguridad ?? estadoLocal?.score_seguridad ?? 0);
  
  let claseRiesgo = $derived.by(() => {
    if (score < 50) return 'is-danger';
    if (score < 75) return 'is-warning';
    return 'is-success';
  });

  let puertos = $derived.by(() => {
    const p = estadoLocal?.puertosAbiertos ?? estadoLocal?.puertos_abiertos;
    if (!p) return [];
    if (Array.isArray(p)) return p;
    if (typeof p === 'string') {
      try {
        const parsed = JSON.parse(p);
        return Array.isArray(parsed) ? parsed : [p];
      } catch (e) {
        return p.split(',').map(s => s.trim()).filter(Boolean);
      }
    }
    return [];
  });

  let vulnerabilidades = $derived.by(() => {
    const v = estadoLocal?.vulnerabilidades;
    if (!v) return [];
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') {
      try {
        const parsed = JSON.parse(v);
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        return [];
      }
    }
    return [];
  });

  async function guardarCambios() {
    if (cargando || !estadoLocal) return;
    cargando = true;
    try {
      if (onGuardar) {
        await onGuardar(estadoLocal);
      }
      cerrar();
    } catch (error) {
      console.error("Error al aprobar/guardar dispositivo:", error);
    } finally {
      cargando = false;
    }
  }

  function cerrar() {
    if (cargando) return; // Evita cerrar el modal mientras procesa
    dispositivo = null;
    onCerrar();
  }

  function imprimirActa() {
    window.print();
  }
</script>

{#if estadoLocal}
  <div class="modal is-active">
    <div 
      class="modal-background" 
      onclick={cerrar} 
      role="button" 
      tabindex="0" 
      onkeydown={(e) => e.key === 'Escape' && cerrar()}
    ></div>
    
    <div class="modal-card modal-width">
      <header class="modal-card-head has-background-dark">
        <p class="modal-card-title has-text-white">
          <span class="icon-text">
            <span>🛡️ Shadow IT: {estadoLocal.ip_detectada || estadoLocal.ip}</span>
          </span>
        </p>
        <button class="delete" aria-label="close" onclick={cerrar} disabled={cargando}></button>
      </header>

      <section class="modal-card-body">
        <!-- Notificación superior explicativa -->
        <div class="notification is-danger is-light p-3 mb-4">
          <p class="has-text-weight-semibold">⚠️ Dispositivo No Autorizado Detectado en Red</p>
          <p class="is-size-7">El worker analizó automáticamente la dirección MAC en busca de coincidencias OUI corporativas.</p>
        </div>

        <div class="columns is-multiline">
          <!-- Columna Izquierda: Specs de Red y OUI Automático -->
          <div class="column is-6">
            <div class="box has-background-white-ter p-3 h-100">
              <p class="is-size-7 has-text-weight-bold text-uppercase mb-2">📡 Información de Conectividad</p>
              <p class="mt-1"><strong>IP Detectada:</strong> <code>{estadoLocal.ip_detectada || estadoLocal.ip}</code></p>
              <p class="mt-1"><strong>MAC Detectada:</strong> <code>{estadoLocal.mac_detectada || estadoLocal.mac}</code></p>
              <p class="mt-1"><strong>Fabricante (OUI):</strong> <span class="tag is-dark is-small">{estadoLocal.fabricante || 'Desconocido / Genérico'}</span></p>
              <p class="mt-1"><strong>Tipo Sugerido:</strong> <span class="tag is-info is-small">{estadoLocal.tipo_sugerido || estadoLocal.tipo || 'PC / Servidor / Otro'}</span></p>
            </div>
          </div>

          <!-- Columna Derecha: Score y Gestión de Estado -->
          <div class="column is-6">
            <div class="box has-background-white-ter p-3 h-100">
              <div class="field mb-3">
                <label class="label is-small">Score de Seguridad</label>
                <span class="tag is-medium {claseRiesgo}">
                  {score} / 100 pts
                </span>
              </div>

              <div class="field">
                <label class="label is-small" for="estado-select">Acción / Estado de Ciclo</label>
                <div class="control">
                  <div class="select is-small is-fullwidth">
                    <select id="estado-select" bind:value={estadoLocal.estado} disabled={cargando}>
                      <option value="Cuarentena">En Cuarentena (Bloqueado)</option>
                      <option value="Aprobado">Aprobado / Pasar a Activos Oficiales</option>
                      <option value="No Autorizado">No Autorizado / Rechazado</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <hr />

        <div class="content">
          <h4>Puertos Detectados</h4>
          {#if puertos.length > 0}
            <div class="tags">
              {#each puertos as puerto}
                <span class="tag is-info is-light">Puerto {puerto}</span>
              {/each}
            </div>
          {:else}
            <p class="has-text-grey is-size-7">No se detectaron puertos abiertos en el sondeo rápido inicial.</p>
          {/if}
        </div>

        <div class="content">
          <h4>Vulnerabilidades / Alertas ({vulnerabilidades.length})</h4>
          {#if vulnerabilidades.length > 0}
            <div class="table-container">
              <table class="table is-fullwidth is-striped is-narrow is-size-7">
                <thead>
                  <tr>
                    <th>CVE / Código</th>
                    <th>Severidad</th>
                    <th>Descripción</th>
                  </tr>
                </thead>
                <tbody>
                  {#each vulnerabilidades as vuln}
                    <tr>
                      <td><code>{vuln.cve || 'N/A'}</code></td>
                      <td>
                        <span class="tag is-small {vuln.severidad === 'Crítica' ? 'is-danger' : vuln.severidad === 'Alta' ? 'is-warning' : 'is-info'}">
                          {vuln.severidad || 'Media'}
                        </span>
                      </td>
                      <td>{vuln.descripcion || vuln}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {:else}
            <p class="has-text-success is-size-7">No se registraron vulnerabilidades críticas asociadas en este endpoint.</p>
          {/if}
        </div>
      </section>

      <footer class="modal-card-foot is-justify-content-space-between">
        <div>
          <button class="button is-small is-light" onclick={imprimirActa} disabled={cargando}>
            🖨️ Imprimir Acta
          </button>
        </div>
        <div>
          <button class="button is-small" onclick={cerrar} disabled={cargando}>Cancelar</button>
          <button class="button is-small is-link {cargando ? 'is-loading' : ''}" onclick={guardarCambios} disabled={cargando}>
            Guardar Cambios
          </button>
        </div>
      </footer>
    </div>
  </div>
{/if}

<style>
  .modal-width {
    width: 100%;
    max-width: 850px;
  }
</style>