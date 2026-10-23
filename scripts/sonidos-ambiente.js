/**
 * Sonidos Ambiente por Escena (Capas en Bucle) - Foundry VTT v12 / v13 / v14
 * Permite añadir 1 o 2 pistas de audio ambiente en bucle a cada escena,
 * reproduciéndolas automáticamente al activar la escena y deteniéndolas al cambiar de escena,
 * de forma totalmente independiente a la lista/canción de música nativa de la escena.
 */

const MODULE_ID = "sonidos-ambiente-escena";

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
 * Genera el HTML de <option> / <optgroup> con todas las listas y pistas del mundo
 */
function buildPlaylistOptionsHtml(selectedVal = "") {
    const playlists = [...(game.playlists || [])].sort((a, b) => a.name.localeCompare(b.name));
    const htmlParts = [`<option value="">— Ninguno —</option>`];

    for (const p of playlists) {
        const sounds = [...(p.sounds || [])].sort((a, b) => a.name.localeCompare(b.name));
        if (sounds.length === 0) continue;

        const safePName = p.name.replace(/"/g, "&quot;");
        htmlParts.push(`<optgroup label="🎵 ${safePName}">`);

        for (const s of sounds) {
            const trackVal = buildTrackValue(p, s);
            const isSelected = isSameResolvedSound(selectedVal, trackVal);
            const safeSName = s.name.replace(/</g, "&lt;").replace(/>/g, "&gt;");
            const safeTrackVal = trackVal.replace(/"/g, "&quot;");
            htmlParts.push(`<option value="${safeTrackVal}" ${isSelected ? "selected" : ""}>${safeSName}</option>`);
        }

        htmlParts.push(`</optgroup>`);
    }

    return htmlParts.join("");
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
    // Solo el GM principal gestiona las actualizaciones de Playlists para evitar colisiones
    const isPrimaryGM = game.users?.activeGM ? (game.users.activeGM.id === game.user?.id) : game.user?.isGM;
    if (!isPrimaryGM || syncInProgress) return;

    syncInProgress = true;
    try {
        const activeScene = game.scenes?.active;
        const desiredTracks = getSceneConfiguredTracks(activeScene);
        const desiredKeys = new Set(desiredTracks.map(t => t.key));

        // Recuperar qué pistas estaban sonando gestionadas por este módulo
        const previouslyManagedKeys = new Set(game.settings.get(MODULE_ID, "managedPlayingTracks") || []);

        // También añadimos por seguridad cualquier pista configurada en otras escenas inactivas que esté sonando ahora
        for (const sc of (game.scenes || [])) {
            if (sc.id === activeScene?.id) continue;
            for (const t of getSceneConfiguredTracks(sc)) {
                if (t.sound.playing) {
                    previouslyManagedKeys.add(t.key);
                }
            }
        }

        // 1. Determinar qué sonidos hay que DETENER (los que estaban gestionados y NO están en la nueva escena)
        const stopsByPlaylist = new Map();
        for (const key of previouslyManagedKeys) {
            if (desiredKeys.has(key)) continue;

            const [pId, sId] = key.split(":::");
            const playlist = game.playlists?.get(pId);
            const sound = playlist?.sounds?.get(sId);
            if (!playlist || !sound || !sound.playing) continue;

            // No detener si casualmente es la pista nativa principal de la escena activa
            if (activeScene && activeScene.playlist === playlist.id && activeScene.playlistSound === sound.id) {
                continue;
            }

            if (!stopsByPlaylist.has(playlist.id)) {
                stopsByPlaylist.set(playlist.id, []);
            }
            stopsByPlaylist.get(playlist.id).push(sound.id);
        }

        // Ejecutar paradas agrupadas por Playlist sin cortar otras canciones de esa misma lista
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

        // 2. Si hay retardo (por ejemplo al cambiar de escena para dejar que Foundry lance primero su playlist nativa), esperamos
        if (delayStartMs > 0 && desiredTracks.length > 0) {
            await new Promise(r => setTimeout(r, delayStartMs));
        }

        // 3. Iniciar en bucle (repeat: true, playing: true) las pistas de la escena activa que aún no estén sonando
        const startsByPlaylist = new Map();
        for (const item of desiredTracks) {
            // Re-obtener documento fresco tras la espera
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

        // 4. Guardar la lista actual de pistas gestionadas por el módulo
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

    // Evitar duplicados si se re-renderiza
    if (root.querySelector(".sae-scene-config-box")) return;

    const scene = app.document || app.object;
    if (!scene) return;

    const currentTrack1 = scene.getFlag(MODULE_ID, "track1") || "";
    const currentTrack2 = scene.getFlag(MODULE_ID, "track2") || "";

    // Buscar el fieldset de Audio en la pestaña Miscelánea (Foundry v12 / v13 / v14)
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
            <div class="form-fields">
                <select name="flags.${MODULE_ID}.track1" class="sae-config-select" data-slot="track1">
                    ${buildPlaylistOptionsHtml(currentTrack1)}
                </select>
            </div>
            <p class="hint">Se reproducirá en bucle al activar la escena, en paralelo a la música de la escena.</p>
        </div>

        <div class="form-group">
            <label>Sonido Ambiente 2</label>
            <div class="form-fields">
                <select name="flags.${MODULE_ID}.track2" class="sae-config-select" data-slot="track2">
                    ${buildPlaylistOptionsHtml(currentTrack2)}
                </select>
            </div>
            <p class="hint">Segunda capa opcional de sonido ambiente en bucle (se detiene al cambiar de escena).</p>
        </div>
    `;

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
            if (ev.target === backdrop) backdrop.remove();
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

    const rowsHtml = scenes.map(sc => {
        const t1 = sc.getFlag(MODULE_ID, "track1") || "";
        const t2 = sc.getFlag(MODULE_ID, "track2") || "";
        const activeBadge = sc.active ? `<span class="sae-active-badge">ACTIVA</span>` : "";

        return `
            <tr data-scene-id="${sc.id}">
                <td>
                    <div class="sae-scene-name">
                        <i class="fa-solid fa-map" style="color:#64748b;"></i>
                        <span>${sc.name}</span>
                        ${activeBadge}
                    </div>
                </td>
                <td>
                    <select class="sae-select sae-quick-select" data-scene-id="${sc.id}" data-slot="track1">
                        ${buildPlaylistOptionsHtml(t1)}
                    </select>
                </td>
                <td>
                    <select class="sae-select sae-quick-select" data-scene-id="${sc.id}" data-slot="track2">
                        ${buildPlaylistOptionsHtml(t2)}
                    </select>
                </td>
            </tr>
        `;
    }).join("");

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
                    Elige hasta 2 pistas de cualquiera de tus listas de audio para cada escena. Al cargar la escena se reproducirán en bucle junto con la música que tenga la escena, y se apagarán automáticamente al cambiar a otra escena.
                </p>
                <table class="sae-table">
                    <thead>
                        <tr>
                            <th style="width: 32%;">Escena</th>
                            <th style="width: 34%;">Sonido Ambiente 1 (Bucle)</th>
                            <th style="width: 34%;">Sonido Ambiente 2 (Bucle)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    backdrop.querySelector("#sae-close-modal")?.addEventListener("click", () => backdrop.remove());

    backdrop.querySelectorAll(".sae-quick-select").forEach(sel => {
        sel.addEventListener("change", async (ev) => {
            const sceneId = ev.currentTarget.dataset.sceneId;
            const slot = ev.currentTarget.dataset.slot;
            const val = ev.currentTarget.value;
            const scene = game.scenes?.get(sceneId);
            if (!scene) return;

            await scene.setFlag(MODULE_ID, slot, val);
            ui.notifications.info(`Audio ambiente actualizado para "${scene.name}".`);
        });
    });
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
    // Al entrar al mundo, sincronizar con la escena activa por si tenía sonidos ambiente configurados
    if (game.user?.isGM) {
        setTimeout(() => syncActiveSceneAmbientAudio({ delayStartMs: 200 }), 500);
    }
});

// Detectar cuando se activa/desactiva una escena o cuando se cambian los flags de audio ambiente de la escena activa
Hooks.on("updateScene", (scene, changed) => {
    if (!game.user?.isGM) return;

    const activeChanged = "active" in changed;
    const flagsChanged = changed.flags && (MODULE_ID in changed.flags) && scene.active;

    if (activeChanged) {
        // Dejamos 350ms de margen al iniciar para que la transición de playlist nativa de Foundry ocurra primero
        syncActiveSceneAmbientAudio({ delayStartMs: changed.active ? 350 : 0 });
    } else if (flagsChanged) {
        syncActiveSceneAmbientAudio({ delayStartMs: 50 });
    }
});

// Añadir botón en la barra de herramientas izquierda (Controles de Audio / Tokens)
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

// Añadir botón también en la pestaña derecha de Escenas y en la de Playlists
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
