# Sonidos Ambiente por Escena (`sonidos-ambiente-escena`)

Módulo para **Foundry VTT (v12 / v13 / v14)** que permite añadir hasta **2 pistas de sonido ambiente adicionales en bucle** a cualquier Escena, de forma independiente a la lista de reproducción o canción nativa configurada en la escena.

## Características

- **Integrado en Configurar Escena (`SceneConfig`):** En la pestaña de Audio / Miscelánea de cada escena aparecen dos desplegables nuevos (*Sonido Ambiente 1* y *Sonido Ambiente 2*) con todas las pistas de tus listas de reproducción.
- **Gestor Rápido de Escenas:** Panel centralizado (accesible desde la pestaña *Escenas*, desde los controles de sonido a la izquierda o con `Alt + A`) para asignar los sonidos ambiente de todas las escenas del mundo de un vistazo.
- **Reproducción en Bucle y en Paralelo:** Al activar la escena, las pistas elegidas se ponen en marcha con `repeat: true` sin interferir con el orden secuencial/aleatorio de la música principal.
- **Transición Inteligente al Cambiar de Escena:** Al cambiar a otra escena, detiene automáticamente los sonidos ambiente de la escena anterior (salvo que la nueva escena utilice el mismo sonido ambiente, en cuyo caso lo mantiene sonando sin cortes).
- **Compatible con Compendios de Aventura:** Guarda los identificadores y los nombres de lista/pista como respaldo para que sigan funcionando al exportar e importar la aventura en otro mundo.

