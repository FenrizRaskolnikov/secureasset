<script lang="ts">
  let { 
    showModal = $bindable(false), 
    sucursales = [], 
    activos = [], 
    onGuardar 
  }: {
    showModal: boolean;
    sucursales: string[];
    activos: any[];
    onGuardar: (sedes: string[]) => void;
  } = $props();

  let listaLocal = $state<string[]>([]);
  let nuevaSede = $state("");

  $effect(() => {
    if (showModal) {
      listaLocal = [...sucursales];
      nuevaSede = "";
    }
  });

  function agregarSede() {
    const trimmed = nuevaSede.trim();
    if (trimmed && !listaLocal.includes(trimmed)) {
      listaLocal = [...listaLocal, trimmed];
      nuevaSede = "";
    }
  }

  function eliminarSede(index: number) {
    const sedeAEliminar = listaLocal[index];
    
    // Validar si hay activos usando esta sede
    const activosEnSede = activos.filter(a => a.ubicacion === sedeAEliminar);

    if (listaLocal.length <= 1) {
      alert("Debe existir al menos una sede en el sistema.");
      return;
    }

    if (activosEnSede.length > 0) {
      const confirmar = confirm(
        `⚠️ ADVERTENCIA: Hay ${activosEnSede.length} activo(s) registrado(s) en "${sedeAEliminar}".\n\nSi eliminas la sede, esos activos dejarán de aparecer en los filtros específicos hasta que los edites o recrees la sede. ¿Deseas continuar de todas formas?`
      );
      if (!confirmar) return;
    }

    listaLocal = listaLocal.filter((_, i) => i !== index);
  }

  function guardar() {
    onGuardar(listaLocal);
    showModal = false;
  }
</script>

<div class="modal {showModal ? 'is-active' : ''}">
  <button type="button" class="modal-background" aria-label="Cerrar" onclick={() => showModal = false}></button>
  <div class="modal-card modal-dark" style="width: 520px; max-width: 95vw;">
    <header class="modal-card-head header-custom">
      <p class="modal-card-title title is-5 has-text-white mb-0">
        ⚙️ Gestionar Sedes / Sucursales
      </p>
      <button class="delete" aria-label="close" onclick={() => showModal = false}></button>
    </header>

    <section class="modal-card-body body-custom">
      <div class="field has-addons mb-4">
        <div class="control is-expanded">
          <input 
            class="input is-small input-dark" 
            type="text" 
            placeholder="Nombre de la nueva sede..." 
            bind:value={nuevaSede}
            onkeydown={(e) => e.key === 'Enter' && agregarSede()}
          />
        </div>
        <div class="control">
          <button class="button is-small is-link" onclick={agregarSede}>
            <span class="icon"><i class="fas fa-plus"></i></span>
            <span>Agregar</span>
          </button>
        </div>
      </div>

      <p class="is-size-7 has-text-grey-light mb-2">Sedes configuradas actualmente:</p>
      <div style="max-height: 200px; overflow-y: auto;">
        <table class="table is-fullwidth table-dark-custom is-narrow is-size-7">
          <tbody>
            {#each listaLocal as sede, i}
              <tr>
                <td>
                  <input class="input is-small input-dark" type="text" bind:value={listaLocal[i]} />
                </td>
                <td class="has-text-centered" style="width: 50px;">
                  <button class="button is-small is-danger is-light" onclick={() => eliminarSede(i)} title="Eliminar sede">
                    <span class="icon is-small"><i class="fas fa-trash"></i></span>
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    <footer class="modal-card-foot footer-custom is-flex is-justify-content-space-between">
      <button class="button is-dark is-small" onclick={() => showModal = false}>Cancelar</button>
      <button class="button is-success is-small font-weight-bold" onclick={guardar}>
        <span class="icon"><i class="fas fa-save"></i></span>
        <span>Guardar cambios</span>
      </button>
    </footer>
  </div>
</div>