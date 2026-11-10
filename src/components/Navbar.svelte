<script lang="ts">
  import PocketBase from 'pocketbase';
  import SedeModal from './SedeModal.svelte';

  let { 
    sucursal = $bindable(), 
    sucursales = [], 
    activos = [],
    esAdmin = false,
    onActualizarSedes,
    stats, 
    onSincronizar 
  } = $props();

  let showSedeModal = $state(false);

  const pbUrl = import.meta.env.PUBLIC_POCKETBASE_URL || 
    (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:8095` : '');
  const pb = new PocketBase(pbUrl);

  let displayName = $derived(pb.authStore.model?.name || pb.authStore.model?.email || 'Admin TI');
</script>

<nav class="navbar is-dark is-spaced has-shadow" aria-label="main navigation">
  <div class="container">
    <div class="navbar-brand">
      <a class="navbar-item logo-container" href="/">
        <img src="/logo-antumalal.png" alt="Logo Empresa" class="company-logo" />
      </a>
    </div>
    <div class="navbar-menu is-active" style="box-shadow:none; background: transparent;">
      <div class="navbar-start ml-4">
        <div class="navbar-item">
          <div class="field has-addons">
            <p class="control has-icons-left">
              <span class="select is-small">
                <select bind:value={sucursal}>
                  <option value="Todas">🌐 Todas las sedes</option>
                  {#each sucursales as s}
                    <option value={s}>{s}</option>
                  {/each}
                </select>
              </span>
              <span class="icon is-small is-left has-text-grey"><i class="fas fa-building"></i></span>
            </p>
            
            <!-- Botón de Sincronizar -->
            <p class="control">
              <button class="button is-small is-info" aria-label="Sincronizar" onclick={onSincronizar} title="Sincronizar datos">
                <span class="icon is-small"><i class="fas fa-sync"></i></span>
              </button>
            </p>

            <!-- Botón de Ajustes / Gestión de Sedes (Solo Administradores) -->
            {#if esAdmin}
              <p class="control">
                <button 
                  class="button is-small is-dark is-outlined" 
                  aria-label="Configurar Sedes" 
                  onclick={() => showSedeModal = true} 
                  title="Gestionar Sedes" 
                  style="border-color: #334155; color: #cbd5e1;"
                >
                  <span class="icon is-small"><i class="fas fa-cog"></i></span>
                </button>
              </p>
            {/if}
          </div>
        </div>
      </div>
      
      <div class="navbar-end">
        <div class="navbar-item has-dropdown is-hoverable">
          <div class="navbar-link has-text-white is-size-7" style="cursor: pointer;">
            <span class="icon mr-1"><i class="fas fa-user-shield has-text-info"></i></span>
            <span>{displayName}</span>
          </div>

          <div class="navbar-dropdown is-right" style="background-color: #1e293b; border: 1px solid #334155;">
            <button 
              class="navbar-item button is-fullwidth is-small has-text-danger" 
              onclick={() => { pb.authStore.clear(); window.location.reload(); }}
              style="background: transparent; border: none; cursor: pointer; text-align: left; width: 100%; padding: 0.5rem 1rem;"
            >
              <span class="icon mr-2"><i class="fas fa-sign-out-alt"></i></span>
              <span>Cerrar Sesión</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</nav>

<!-- Modal de gestión de sedes montado al final -->
<SedeModal 
  bind:showModal={showSedeModal} 
  {sucursales} 
  {activos}
  onGuardar={onActualizarSedes} 
/>

<style>
  :global(.navbar.is-dark) { background-color: #22262f; }

  .logo-container {
    padding-top: 0.3rem !important;
    padding-bottom: 0.3rem !important;
  }

  .company-logo {
    height: 40px !important;
    max-height: 40px !important;
    width: auto !important;
    object-fit: contain;
  }
</style>