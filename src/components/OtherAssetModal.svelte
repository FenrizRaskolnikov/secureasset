<script lang="ts">
  import PocketBase from 'pocketbase';

  let { 
    showModal = $bindable(), 
    modalActivo, 
    closeModal,
    onAbrirEditar
  }: {
    showModal: boolean;
    modalActivo: any;
    closeModal: () => void;
    onAbrirEditar?: (activo: any) => void;
  } = $props();

  const pbUrl = import.meta.env.PUBLIC_POCKETBASE_URL || 
    (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:8095` : '');
  const pb = new PocketBase(pbUrl);

  let esAdmin = $derived(pb.authStore.model?.role === 'admin' || pb.authStore.model?.es_admin === true);
</script>

<div class="modal {showModal ? 'is-active' : ''}">
  <button type="button" class="modal-background" aria-label="Cerrar modal" onclick={closeModal}></button>
  {#if modalActivo}
    <div class="modal-card modal-dark" style="width: 700px; max-width: 95vw;">
      <header class="modal-card-head header-custom">
        <div class="is-flex is-align-items-center">
          <span class="title is-4 has-text-white mb-0 mr-3">{modalActivo.hostname}</span>
          <span class="tag is-dark mr-2">Otros / Neutro</span>
          <span class="tag is-info is-light">Sin Score Promedio</span>
        </div>
        <button class="delete is-large" aria-label="close" onclick={closeModal}></button>
      </header>

      <section class="modal-card-body body-custom">
        <div class="notification is-warning is-light mb-4">
          <p class="has-text-weight-semibold">ℹ️ Dispositivo en Categoría Neutra ("Otros")</p>
          <p class="is-size-7">Dispositivos reconocidos diferentes a PCs/NVRs/Servidores o dispositivos que no pudieron ser clasificados automáticamente.</p>
        </div>

        <div class="columns is-multiline">
          <div class="column is-12">
            <h3 class="subtitle is-6 has-text-info font-weight-bold mb-2"><i class="fas fa-info-circle mr-1"></i> Detalles Técnicos</h3>
            <table class="table is-fullwidth table-dark-custom is-narrow">
              <tbody>
                <tr><td><strong>Hostname</strong></td><td>{modalActivo.hostname}</td></tr>
                <tr><td><strong>IP</strong></td><td><span class="is-family-monospace">{modalActivo.ip}</span></td></tr>
                <tr><td><strong>MAC</strong></td><td><span class="is-family-monospace">{modalActivo.mac}</span></td></tr>
                <tr><td><strong>Fabricante (OUI)</strong></td><td>{modalActivo.fabricante || 'Desconocido'}</td></tr>
                <tr><td><strong>Ubicación</strong></td><td>{modalActivo.ubicacion || 'Sede Central'}</td></tr>
                <tr><td><strong>Estado Ciclo</strong></td><td><span class="tag is-small is-warning">{modalActivo.estado_ciclo || 'Operativo'}</span></td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <footer class="modal-card-foot footer-custom is-flex is-justify-content-space-between is-align-items-center">
        <div>
          {#if onAbrirEditar && esAdmin}
            <button class="button is-small is-warning is-outlined" onclick={() => onAbrirEditar(modalActivo)}>
              <span class="icon"><i class="fas fa-edit"></i></span><span>Editar Ficha</span>
            </button>
          {/if}
        </div>
        <div>
          <button class="button is-dark is-small" onclick={closeModal}>Cerrar</button>
        </div>
      </footer>
    </div>
  {/if}
</div>