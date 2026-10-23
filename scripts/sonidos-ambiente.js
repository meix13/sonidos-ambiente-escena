/**
 * Sonidos Ambiente por Escena (Capas en Bucle) - Foundry VTT v12 / v13 / v14
 * Permite añadir 1 o 2 pistas de audio ambiente en bucle a cada escena con buscador/autocompletado,
 * reproduciéndolas automáticamente al activar la escena y deteniéndolas al cambiar de escena,
 * de forma totalmente independiente a la lista/canción de música nativa de la escena.
 */

const MODULE_ID = "sonidos-ambiente-escena";

/**
 * Normaliza texto quitando tildes y pasando a minúsculas para búsquedas rápidas
 */
function normalizeSearch(str) {
    return (str || "")
        .toString()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}

/**
 * Escapa caracteres HTML
 */
function escapeHtml(str) {
    return (str || "")
        .toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/**
 * Construye el identificador único de una pista incluyendo nombres como fallback
 * por si la escena se exporta a un compendio de aventura y se importa en otro mundo.
 */
function buildTrackValue(playlist, sound) {
    if (!playlist || !sound) return "";
    return `${playlist.id}:::${sound.id}:::${playlist.name}:::${sound.name}`;
}

/**
 * Resuelve un valor guardado (playlistId:::soundId:::playlistName:::soundName)
 * devolviendo { playlist, sound } si existe en el mundo actual.
 */
function resolveTrackValue(val) {
    if (!val || typeof val !== "string") return null;
    const parts = val.split(":::");
    const [playlistId, soundId, playlistName, soundName] = parts;

    // 1. Intentar por ID exacto
    let playlist = game.playlists?.get(playlistId);
    let sound = playlist?.sounds?.get(soundId);
    if (playlist && sound) return { playlist, sound };

    // 2. Fallback por nombre de Playlist + nombre de Pista (útil tras importar aventuras)
    if (playlistName && soundName) {
        playlist = game.playlists?.find(p => p.name === playlistName);
        sound = playlist?.sounds?.find(s => s.name === soundName);
        if (playlist && sound) return { playlist, sound };
    }

    // 3. Fallback buscando el soundId o soundName en cualquier lista
    for (const p of (game.playlists || [])) {
        const sById = p.sounds.get(soundId);
        if (sById) return { playlist: p, sound: sById };
        if (soundName) {
            const sByName = p.sounds.find(s => s.name === soundName);
            if (sByName) return { playlist: p, sound: sByName };
        }
    }

    return null;
}

/**
 * Comprueba si dos valores de track apuntan al mismo sonido real
 */
function isSameResolvedSound(valA, valB) {
    if (!valA || !valB) return false;
    if (valA === valB) return true;
    const resA = resolveTrackValue(valA);
    const resB = resolveTrackValue(valB);
    if (!resA || !resB) return false;
    return resA.playlist.id === resB.playlist.id && resA.sound.id === resB.sound.id;
}

/**
 * Obtiene el catálogo completo de listas y pistas disponibles en el mundo
 */
function getPlaylistCatalog() {
    const playlists = [...(game.playlists || [])].sort((a, b) => a.name.localeCompare(b.name));
    const catalog = [];

    for (const p of playlists) {
        const sounds = [...(p.sounds || [])].sort((a, b) => a.name.localeCompare(b.name));
        if (sounds.length === 0) continue;

        catalog.push({
            playlistId: p.id,
            playlistName: p.name,
            playlistNorm: normalizeSearch(p.name),
            sounds: sounds.map(s => ({
                soundId: s.id,
                soundName: s.name,
                soundNorm: normalizeSearch(s.name),
                value: buildTrackValue(p, s)
            }))
        });
    }
    return catalog;
}

/* ==========================================================================
   COMPONENTE BUSCADOR / AUTOCOMPLETAR DE PISTAS DE AUDIO
   ========================================================================== */

let activeDropdownCleanup = null;

function closeAnyOpenPickerDropdown() {
    if (typeof activeDropdownCleanup === "function") {
        activeDropdownCleanup();
        activeDropdownCleanup = null;
    }
}

/**
 * Crea un widget DOM con buscador/autocompletado en tiempo real para elegir una pista
 */
function createTrackPickerElement({ inputName = "", initialValue = "", onSelect = null } = {}) {
    let currentValue = initialValue || "";

    const wrapper = document.createElement("div");
    wrapper.className = "sae-picker";

    // Input oculto para que los formularios nativos de Foundry (SceneConfig) también recojan el valor
    const hiddenInput = document.createElement("input");
    hiddenInput.type = "hidden";
    if (inputName) hiddenInput.name = inputName;
    hiddenInput.value = currentValue;
    wrapper.appendChild(hiddenInput);

    const trigger = document.createElement("div");
    trigger.className = "sae-picker-trigger";
    trigger.tabIndex = 0;
    wrapper.appendChild(trigger);

    function updateTriggerDisplay() {
        hiddenInput.value = currentValue;
        const resolved = resolveTrackValue(currentValue);

        if (!resolved) {
            trigger.innerHTML = `
                <span class="sae-picker-label is-empty">🔍 Buscar o elegir pista... (Ninguno)</span>
                <div class="sae-picker-actions">
                    <i class="fa-solid fa-chevron-down sae-picker-chevron"></i>
                </div>
            `;
        } else {
            trigger.innerHTML = `
                <span class="sae-picker-label" title="${escapeHtml(resolved.playlist.name)} — ${escapeHtml(resolved.sound.name)}">
                    <span class="sae-picker-playlist-tag">[${escapeHtml(resolved.playlist.name)}]</span>
                    <span>${escapeHtml(resolved.sound.name)}</span>
                </span>
                <div class="sae-picker-actions">
                    <span class="sae-picker-clear" title="Quitar sonido ambiente"><i class="fa-solid fa-xmark"></i></span>
                    <i class="fa-solid fa-chevron-down sae-picker-chevron"></i>
                </div>
            `;

            trigger.querySelector(".sae-picker-clear")?.addEventListener("click", (ev) => {
                ev.stopPropagation();
                closeAnyOpenPickerDropdown();
                setValue("");
            });
        }
    }

    function setValue(newVal) {
        currentValue = newVal || "";
        updateTriggerDisplay();
        if (typeof onSelect === "function") {
            onSelect(currentValue);
        }
        // Disparar evento change en el hiddenInput por si Foundry vigila cambios del form
        hiddenInput.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function openDropdown() {
        if (wrapper.classList.contains("is-open")) {
            closeAnyOpenPickerDropdown();
            return;
        }
        closeAnyOpenPickerDropdown();

        wrapper.classList.add("is-open");

        const dropdown = document.createElement("div");
        dropdown.className = "sae-picker-dropdown is-open";
        dropdown.innerHTML = `
            <div class="sae-picker-search-wrap">
                <i class="fa-solid fa-magnifying-glass"></i>
                <input type="text" class="sae-picker-search-input" placeholder="Escribe para buscar pista o lista..." autocomplete="off" />
            </div>
            <div class="sae-picker-list"></div>
        `;
        document.body.appendChild(dropdown);

        // Posicionar justo debajo (o encima si no cabe abajo) del trigger
        const rect = trigger.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        const dropWidth = Math.max(rect.width, 300);
        dropdown.style.width = `${dropWidth}px`;
        dropdown.style.left = `${Math.min(rect.left, window.innerWidth - dropWidth - 10)}px`;

        if (spaceBelow < 260 && rect.top > 260) {
            dropdown.style.bottom = `${window.innerHeight - rect.top + 4}px`;
            dropdown.style.top = "auto";
        } else {
            dropdown.style.top = `${rect.bottom + 4}px`;
            dropdown.style.bottom = "auto";
        }

        const searchInput = dropdown.querySelector(".sae-picker-search-input");
        const listEl = dropdown.querySelector(".sae-picker-list");
        const catalog = getPlaylistCatalog();

        let highlightedIndex = 0;
        let selectableElements = [];

        function renderFilteredOptions(query = "") {
            const normQuery = normalizeSearch(query);
            listEl.innerHTML = "";
            selectableElements = [];

            // Opción "Ninguno" si no hay filtro o si coincide con "ninguno"
            if (!normQuery || "ninguno".includes(normQuery)) {
                const noneOpt = document.createElement("div");
                noneOpt.className = `sae-picker-option ${!currentValue ? "is-selected" : ""}`;
                noneOpt.dataset.val = "";
                noneOpt.innerHTML = `<span style="color:#94a3b8; font-style:italic;">— Ninguno (Sin sonido ambiente) —</span>`;
                noneOpt.addEventListener("click", () => {
                    closeAnyOpenPickerDropdown();
                    setValue("");
                });
                listEl.appendChild(noneOpt);
                selectableElements.push(noneOpt);
            }

            let totalMatches = 0;

            for (const group of catalog) {
                const playlistMatches = normQuery && group.playlistNorm.includes(normQuery);
                const matchingSounds = group.sounds.filter(s =>
                    !normQuery || playlistMatches || s.soundNorm.includes(normQuery)
                );

                if (matchingSounds.length === 0) continue;
                totalMatches += matchingSounds.length;

                const groupHeader = document.createElement("div");
                groupHeader.className = "sae-picker-group-title";
                groupHeader.textContent = `🎵 ${group.playlistName}`;
                listEl.appendChild(groupHeader);

                for (const s of matchingSounds) {
                    const opt = document.createElement("div");
                    const isSel = isSameResolvedSound(currentValue, s.value);
                    opt.className = `sae-picker-option ${isSel ? "is-selected" : ""}`;
                    opt.dataset.val = s.value;
                    opt.innerHTML = `
                        <span>${escapeHtml(s.soundName)}</span>
                        ${isSel ? `<i class="fa-solid fa-check" style="color:#34d399; font-size:11px;"></i>` : ""}
                    `;
                    opt.addEventListener("click", () => {
                        closeAnyOpenPickerDropdown();
                        setValue(s.value);
                    });
                    listEl.appendChild(opt);
                    selectableElements.push(opt);
                }
            }

            if (totalMatches === 0 && normQuery) {
                const empty = document.createElement("div");
                empty.className = "sae-picker-empty-msg";
                empty.textContent = `No se encontraron pistas con "${query}"`;
                listEl.appendChild(empty);
            }

            highlightedIndex = 0;
            updateHighlight();
        }

        function updateHighlight() {
            selectableElements.forEach((el, idx) => {
                el.classList.toggle("is-highlighted", idx === highlightedIndex);
            });
            const activeEl = selectableElements[highlightedIndex];
            if (activeEl) {
                activeEl.scrollIntoView({ block: "nearest" });
            }
        }

        searchInput.addEventListener("input", (ev) => {
            renderFilteredOptions(ev.target.value);
        });

        searchInput.addEventListener("keydown", (ev) => {
            if (ev.key === "ArrowDown") {
                ev.preventDefault();
                if (selectableElements.length > 0) {
                    highlightedIndex = (highlightedIndex + 1) % selectableElements.length;
                    updateHighlight();
                }
            } else if (ev.key === "ArrowUp") {
                ev.preventDefault();
                if (selectableElements.length > 0) {
                    highlightedIndex = (highlightedIndex - 1 + selectableElements.length) % selectableElements.length;
                    updateHighlight();
                }
            } else if (ev.key === "Enter") {
                ev.preventDefault();
                const chosen = selectableElements[highlightedIndex];
                if (chosen) chosen.click();
            } else if (ev.key === "Escape") {
                ev.preventDefault();
                closeAnyOpenPickerDropdown();
            }
        });

        renderFilteredOptions("");
        setTimeout(() => searchInput.focus(), 10);

        const onOutsideClick = (ev) => {
            if (!dropdown.contains(ev.target) && !wrapper.contains(ev.target)) {
                closeAnyOpenPickerDropdown();
            }
        };

        document.addEventListener("mousedown", onOutsideClick, true);

        activeDropdownCleanup = () => {
            document.removeEventListener("mousedown", onOutsideClick, true);
            wrapper.classList.remove("is-open");
            dropdown.remove();
        };
    }

    trigger.addEventListener("click", () => openDropdown());
    trigger.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " " || ev.key === "ArrowDown") {
            ev.preventDefault();
            openDropdown();
        }
    });

    updateTriggerDisplay();
    return wrapper;
}

/**
 * Obtiene las pistas ambiente configuradas en una escena (devuelve array de objetos { playlist, sound, key })
 */
function getSceneConfiguredTracks(scene) {
    if (!scene) return [];
    const flags = scene.flags?.[MODULE_ID] || {};
    const rawValues = [flags.track1, flags.track2].filter(Boolean);

    const resolvedList = [];
    const seenKeys = new Set();

    for (const raw of rawValues) {
        const resolved = resolveTrackValue(raw);
        if (resolved) {
            const key = `${resolved.playlist.id}:::${resolved.sound.id}`;
            if (!seenKeys.has(key)) {
                seenKeys.add(key);
                resolvedList.push({
                    playlist: resolved.playlist,
                    sound: resolved.sound,
                    key
                });
            }
        }
    }
    return resolvedList;
}

/* ==========================================================================
   1. MOTOR DE REPRODUCCIÓN Y PARADA AL CAMBIAR DE ESCENA
   ========================================================================== */

let syncInProgress = false;

/**
 * Sincroniza los sonidos ambiente con la escena activa actual:
 * - Detiene los sonidos ambiente de la escena anterior que ya no correspondan.
 * - Inicia en bucle (repeat: true) los 1 o 2 sonidos ambiente de la escena activa.
 */
async function syncActiveSceneAmbientAudio({ delayStartMs = 0 } = {}) {
    const isPrimaryGM = game.users?.activeGM ? (game.users.activeGM.id === game.user?.id) : game.user?.isGM;
    if (!isPrimaryGM || syncInProgress) return;

    syncInProgress = true;
    try {
        const activeScene = game.scenes?.active;
        const desiredTracks = getSceneConfiguredTracks(activeScene);
        const desiredKeys = new Set(desiredTracks.map(t => t.key));

        const previouslyManagedKeys = new Set(game.settings.get(MODULE_ID, "managedPlayingTracks") || []);

        for (const sc of (game.scenes || [])) {
            if (sc.id === activeScene?.id) continue;
            for (const t of getSceneConfiguredTracks(sc)) {
                if (t.sound.playing) {
                    previouslyManagedKeys.add(t.key);
                }
            }
        }

        // 1. Determinar qué sonidos hay que DETENER
        const stopsByPlaylist = new Map();
        for (const key of previouslyManagedKeys) {
            if (desiredKeys.has(key)) continue;

            const [pId, sId] = key.split(":::");
            const playlist = game.playlists?.get(pId);
            const sound = playlist?.sounds?.get(sId);
            if (!playlist || !sound || !sound.playing) continue;

            if (activeScene && activeScene.playlist === playlist.id && activeScene.playlistSound === sound.id) {
                continue;
            }

            if (!stopsByPlaylist.has(playlist.id)) {
                stopsByPlaylist.set(playlist.id, []);
            }
            stopsByPlaylist.get(playlist.id).push(sound.id);
        }

        for (const [pId, soundIdsToStop] of stopsByPlaylist.entries()) {
            const playlist = game.playlists?.get(pId);
            if (!playlist) continue;

            const stopSet = new Set(soundIdsToStop);
            const stillPlayingOther = playlist.sounds.some(s => !stopSet.has(s.id) && s.playing);

            await playlist.update({
                playing: stillPlayingOther,
                sounds: soundIdsToStop.map(id => ({
                    _id: id,
                    playing: false,
                    pausedTime: null
                }))
            });
        }

        // 2. Retardo opcional para dejar que la transición nativa de Foundry ocurra antes
        if (delayStartMs > 0 && desiredTracks.length > 0) {
            await new Promise(r => setTimeout(r, delayStartMs));
        }

        // 3. Iniciar en bucle (repeat: true, playing: true) las pistas de la escena activa
        const startsByPlaylist = new Map();
        for (const item of desiredTracks) {
            const freshPlaylist = game.playlists?.get(item.playlist.id);
            const freshSound = freshPlaylist?.sounds?.get(item.sound.id);
            if (!freshPlaylist || !freshSound) continue;

            if (!freshSound.playing || !freshSound.repeat) {
                if (!startsByPlaylist.has(freshPlaylist.id)) {
                    startsByPlaylist.set(freshPlaylist.id, []);
                }
                startsByPlaylist.get(freshPlaylist.id).push(freshSound.id);
            }
        }

        for (const [pId, soundIdsToStart] of startsByPlaylist.entries()) {
            const playlist = game.playlists?.get(pId);
            if (!playlist) continue;

            await playlist.update({
                playing: true,
                sounds: soundIdsToStart.map(id => ({
                    _id: id,
                    playing: true,
                    repeat: true,
                    pausedTime: null
                }))
            });
        }

        await game.settings.set(MODULE_ID, "managedPlayingTracks", Array.from(desiredKeys));
    } catch (err) {
        console.warn(`${MODULE_ID} | Error sincronizando sonidos ambiente de escena:`, err);
    } finally {
        syncInProgress = false;
    }
}

/* ==========================================================================
   2. INYECCIÓN EN LA VENTANA "CONFIGURAR ESCENA" (SceneConfig)
   ========================================================================== */

Hooks.on("renderSceneConfig", (app, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;

    if (root.querySelector(".sae-scene-config-box")) return;

    const scene = app.document || app.object;
    if (!scene) return;

    const currentTrack1 = scene.getFlag(MODULE_ID, "track1") || "";
    const currentTrack2 = scene.getFlag(MODULE_ID, "track2") || "";

    const playlistSoundSelect = root.querySelector('[name="playlistSound"]');
    const targetContainer = playlistSoundSelect?.closest("fieldset") ||
                            root.querySelector('[data-tab="misc"]') ||
                            root.querySelector('[data-tab="ambience"]');

    if (!targetContainer) return;

    const box = document.createElement("div");
    box.className = "sae-scene-config-box";
    box.innerHTML = `
        <div class="sae-scene-config-header">
            <i class="fa-solid fa-cloud-showers-heavy"></i>
            <span>Sonidos Ambiente Adicionales (En Bucle)</span>
        </div>

        <div class="form-group">
            <label>Sonido Ambiente 1</label>
            <div class="form-fields" id="sae-config-slot-1"></div>
            <p class="hint">Se reproducirá en bucle al activar la escena, en paralelo a la música de la escena.</p>
        </div>

        <div class="form-group">
            <label>Sonido Ambiente 2</label>
            <div class="form-fields" id="sae-config-slot-2"></div>
            <p class="hint">Segunda capa opcional de sonido ambiente en bucle (se detiene al cambiar de escena).</p>
        </div>
    `;

    const slot1 = box.querySelector("#sae-config-slot-1");
    const slot2 = box.querySelector("#sae-config-slot-2");

    slot1.appendChild(createTrackPickerElement({
        inputName: `flags.${MODULE_ID}.track1`,
        initialValue: currentTrack1,
        onSelect: async (val) => {
            await scene.setFlag(MODULE_ID, "track1", val);
        }
    }));

    slot2.appendChild(createTrackPickerElement({
        inputName: `flags.${MODULE_ID}.track2`,
        initialValue: currentTrack2,
        onSelect: async (val) => {
            await scene.setFlag(MODULE_ID, "track2", val);
        }
    }));

    targetContainer.appendChild(box);
});

/* ==========================================================================
   3. PANEL GESTOR RÁPIDO PARA TODAS LAS ESCENAS DEL MUNDO
   ========================================================================== */

function openAmbientManagerModal() {
    if (!game.user?.isGM) return;

    let backdrop = document.getElementById("sae-modal-backdrop");
    if (!backdrop) {
        backdrop = document.createElement("div");
        backdrop.id = "sae-modal-backdrop";
        backdrop.className = "sae-modal-backdrop";
        backdrop.addEventListener("click", (ev) => {
            if (ev.target === backdrop) {
                closeAnyOpenPickerDropdown();
                backdrop.remove();
            }
        });
        document.body.appendChild(backdrop);
    }

    renderAmbientManagerModal(backdrop);
}

function renderAmbientManagerModal(backdrop) {
    const scenes = [...(game.scenes || [])].sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return a.name.localeCompare(b.name);
    });

    backdrop.innerHTML = `
        <div class="sae-modal">
            <div class="sae-modal-header">
                <div class="sae-modal-title">
                    <i class="fa-solid fa-cloud-showers-heavy"></i>
                    <span>SONIDOS AMBIENTE POR ESCENA (CAPAS EN BUCLE)</span>
                </div>
                <button type="button" class="sae-btn" id="sae-close-modal">
                    <i class="fa-solid fa-xmark"></i> Cerrar
                </button>
            </div>
            <div class="sae-modal-body">
                <p style="font-size:12px; color:#94a3b8; margin-top:0; margin-bottom:14px;">
                    Haz clic en cualquier selector y <strong>escribe para buscar</strong> por nombre de pista o lista de audio. Al cargar la escena se reproducirán en bucle junto con la música de la escena, y se detendrán al cambiar de escena.
                </p>
                <table class="sae-table">
                    <thead>
                        <tr>
                            <th style="width: 30%;">Escena</th>
                            <th style="width: 35%;">Sonido Ambiente 1 (Bucle)</th>
                            <th style="width: 35%;">Sonido Ambiente 2 (Bucle)</th>
                        </tr>
                    </thead>
                    <tbody id="sae-scenes-tbody"></tbody>
                </table>
            </div>
        </div>
    `;

    backdrop.querySelector("#sae-close-modal")?.addEventListener("click", () => {
        closeAnyOpenPickerDropdown();
        backdrop.remove();
    });

    const tbody = backdrop.querySelector("#sae-scenes-tbody");

    for (const sc of scenes) {
        const t1 = sc.getFlag(MODULE_ID, "track1") || "";
        const t2 = sc.getFlag(MODULE_ID, "track2") || "";
        const activeBadge = sc.active ? `<span class="sae-active-badge">ACTIVA</span>` : "";

        const tr = document.createElement("tr");
        tr.dataset.sceneId = sc.id;
        tr.innerHTML = `
            <td>
                <div class="sae-scene-name">
                    <i class="fa-solid fa-map" style="color:#64748b;"></i>
                    <span>${escapeHtml(sc.name)}</span>
                    ${activeBadge}
                </div>
            </td>
            <td class="sae-cell-t1"></td>
            <td class="sae-cell-t2"></td>
        `;

        tr.querySelector(".sae-cell-t1").appendChild(createTrackPickerElement({
            initialValue: t1,
            onSelect: async (val) => {
                await sc.setFlag(MODULE_ID, "track1", val);
                ui.notifications.info(`Sonido Ambiente 1 actualizado en "${sc.name}".`);
            }
        }));

        tr.querySelector(".sae-cell-t2").appendChild(createTrackPickerElement({
            initialValue: t2,
            onSelect: async (val) => {
                await sc.setFlag(MODULE_ID, "track2", val);
                ui.notifications.info(`Sonido Ambiente 2 actualizado en "${sc.name}".`);
            }
        }));

        tbody.appendChild(tr);
    }
}

/* ==========================================================================
   4. HOOKS DE FOUNDRY VTT (INIT, READY, UPDATESCENE, BOTONES)
   ========================================================================== */

Hooks.once("init", () => {
    console.log(`${MODULE_ID} | Inicializando Sonidos Ambiente por Escena...`);

    game.settings.register(MODULE_ID, "managedPlayingTracks", {
        name: "Pistas ambiente activas gestionadas por el módulo",
        scope: "world",
        config: false,
        type: Array,
        default: []
    });

    if (game.keybindings) {
        game.keybindings.register(MODULE_ID, "openManager", {
            name: "Abrir Gestor de Sonidos Ambiente por Escena",
            hint: "Permite asignar rápidamente 1 o 2 pistas ambiente en bucle a cada escena del mundo.",
            editable: [{ key: "KeyA", modifiers: ["Alt"] }],
            restricted: true,
            onDown: () => {
                openAmbientManagerModal();
                return true;
            }
        });
    }

    window.SonidosAmbienteEscena = {
        openManager: () => openAmbientManagerModal(),
        syncNow: () => syncActiveSceneAmbientAudio()
    };
});

Hooks.once("ready", () => {
    if (game.user?.isGM) {
        setTimeout(() => syncActiveSceneAmbientAudio({ delayStartMs: 200 }), 500);
    }
});

Hooks.on("updateScene", (scene, changed) => {
    if (!game.user?.isGM) return;

    const activeChanged = "active" in changed;
    const flagsChanged = changed.flags && (MODULE_ID in changed.flags) && scene.active;

    if (activeChanged) {
        syncActiveSceneAmbientAudio({ delayStartMs: changed.active ? 350 : 0 });
    } else if (flagsChanged) {
        syncActiveSceneAmbientAudio({ delayStartMs: 50 });
    }
});

Hooks.on("getSceneControlButtons", (controls) => {
    const toolData = {
        name: "sonidos-ambiente-escena",
        title: "Sonidos Ambiente por Escena (Capas en Bucle)",
        icon: "fa-solid fa-cloud-showers-heavy",
        visible: game.user?.isGM,
        button: true,
        onClick: () => openAmbientManagerModal(),
        onChange: () => openAmbientManagerModal()
    };

    if (Array.isArray(controls)) {
        const targetGroup = controls.find(c => c.name === "sounds") || controls.find(c => c.name === "token" || c.name === "tokens");
        if (targetGroup && Array.isArray(targetGroup.tools)) {
            targetGroup.tools.push(toolData);
        }
    } else if (controls && typeof controls === "object") {
        const targetGroup = controls.sounds || controls.tokens || controls.token;
        if (targetGroup && targetGroup.tools) {
            if (Array.isArray(targetGroup.tools)) {
                targetGroup.tools.push(toolData);
            } else {
                targetGroup.tools["sonidos-ambiente-escena"] = {
                    ...toolData,
                    order: Object.keys(targetGroup.tools).length + 1
                };
            }
        }
    }
});

Hooks.on("renderSceneDirectory", (app, html) => {
    if (!game.user?.isGM) return;
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root || root.querySelector(".sae-scene-dir-btn")) return;

    const headerActions = root.querySelector(".header-actions");
    if (headerActions) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "sae-scene-dir-btn";
        btn.style.cssText = "background:#0b1120; border:1px solid #38bdf8; color:#38bdf8; font-family:monospace; font-weight:bold;";
        btn.innerHTML = `<i class="fa-solid fa-cloud-showers-heavy"></i> Audio Ambiente Escenas`;
        btn.addEventListener("click", () => openAmbientManagerModal());
        headerActions.appendChild(btn);
    }
});
