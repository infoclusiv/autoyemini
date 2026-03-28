# Plan de Implementación: Sistema Anti-Bot Configurable para ChatGPT Extension

## 🎯 Objetivo General
Implementar un sistema de humanización (Anti-Bot) para evitar que la extensión sea detectada por sistemas de seguridad. El sistema simulará escritura humana, clics no lineales, tiempos de espera aleatorios (jittering) y fatiga de sesión. Todas estas opciones deben ser configurables por el usuario a través de la interfaz (Side Panel).

---

## 🛠️ FASE 1: Utilidades Base y Configuración por Defecto

### 1.1 Modificar `shared/utils.js`
**Objetivo:** Añadir funciones para generar pausas y números aleatorios.
*   **Acción:** Añadir la función `randomInt(min, max)` que retorne un entero entre min y max.
*   **Acción:** Añadir la función `randomSleep(min, max)` que retorne una Promesa usando `setTimeout` con un tiempo generado por `randomInt`.
*   **Acción:** Exportar estas nuevas funciones en el objeto `SharedUtils`.

### 1.2 Modificar `config.js`
**Objetivo:** Definir los valores predeterminados y las nuevas llaves de almacenamiento.
*   **Acción:** Modificar el objeto `CONFIG.TIMING` para que los tiempos estáticos pasen a ser arrays `[min, max]`. Ejemplo: `BETWEEN_QUESTIONS_MS: [3500, 8000]`.
*   **Acción:** Añadir una nueva sección `CONFIG.ANTI_BOT` con valores por defecto:
    ```javascript
    ANTI_BOT: {
      TYPING_SPEED_MS: [30, 100],
      ERROR_PROBABILITY: 0.02, // 2% de probabilidad de error al teclear
      FATIGUE_AFTER_QUESTIONS: 10,
      FATIGUE_PAUSE_MS: [20000, 40000]
    }
    ```
*   **Acción:** Añadir las nuevas claves en `CONFIG.STORAGE_KEYS`: `HUMAN_TYPING`, `RANDOM_DELAYS`, `BIOLOGICAL_PAUSES`, `TYPING_SPEED`.

---

## 🖥️ FASE 2: Interfaz de Usuario (UI) y Almacenamiento

### 2.1 Modificar `sidepanel.html`
**Objetivo:** Crear una nueva sección de configuración en el Panel de Control.
*   **Acción:** Debajo del div `<div class="settings-group">`, añadir un nuevo grupo llamado "🤖 Opciones Anti-Bot" (`<div class="settings-group anti-bot-settings">`).
*   **Acción:** Añadir los siguientes controles (inputs):
    1.  **Checkbox:** Habilitar Escritura Humana (Simular tecleo).
    2.  **Checkbox:** Habilitar Tiempos Aleatorios (Jittering).
    3.  **Checkbox:** Habilitar Pausas Biológicas (Descanso por fatiga).
    4.  **Number Inputs (Avanzado):** 
        *   Preguntas antes de descansar (Ej. 10).
        *   Minutos de descanso (Ej. 1 - 2).

### 2.2 Modificar `sidepanel.css`
**Objetivo:** Dar estilo a los nuevos inputs numéricos y agrupar visualmente la sección Anti-Bot.
*   **Acción:** Añadir estilos para inputs de tipo `number` dentro de `.setting-item`.
*   **Acción:** Crear una clase `.settings-subgroup` para que los inputs numéricos se muestren condicionalmente si el checkbox de "Pausas Biológicas" está activo.

### 2.3 Modificar `sidepanel/services/storageService.js` y `appState.js`
**Objetivo:** Guardar y leer las nuevas configuraciones.
*   **Acción (`storageService.js`):** Actualizar `StorageKeys` y la función `loadAll()` para recuperar las nuevas variables (ej. `humanTyping`, `randomDelays`, `biologicalPauses`, `fatigueCount`).
*   **Acción (`appState.js`):** Añadir estos nuevos campos al estado inicial de `state`.

### 2.4 Modificar `sidepanel/ui/settingsPanel.js`
**Objetivo:** Vincular los inputs del DOM con la lógica.
*   **Acción:** Leer los elementos del DOM en el constructor.
*   **Acción:** Modificar `setValues()` y `getValues()` para incluir la configuración Anti-Bot.

### 2.5 Actualizar Locales (`_locales/en/messages.json` y `es/messages.json`)
**Objetivo:** Añadir las traducciones para la nueva UI.
*   **Acción:** Añadir llaves como: `controlHumanTyping`, `controlHumanTypingHint`, `controlBiologicalPauses`, etc.

---

## ⚙️ FASE 3: Lógica de Pausas y Envío de Parámetros (Orquestación)

### 3.1 Modificar `sidepanel/sidepanel.js`
**Objetivo:** Leer la configuración, aplicar "Fatiga" y enviar configuraciones al Content Script.
*   **Acción:** Configurar Event Listeners para guardar las opciones Anti-Bot cuando el usuario interactúe con ellas.
*   **Acción:** Dentro de `processNextQuestion()`:
    1.  Obtener la configuración Anti-Bot de `settingsPanel.getValues()`.
    2.  *Lógica de Fatiga:* Mantener un contador de preguntas procesadas. Si `biologicalPauses` es `true` y el contador alcanza `fatigueCount`, ejecutar `await SharedUtils.randomSleep(min, max)` y emitir un log: *"Pausa biológica activada. Simulando descanso humano..."*.
    3.  *Delay Aleatorio:* Cambiar `sleep(AppConfig.TIMING.BETWEEN_QUESTIONS_MS)` por `SharedUtils.randomSleep()` si `randomDelays` es `true`.
    4.  Añadir las configuraciones Anti-Bot al payload de `sendToBackground({ type: "PROCESS_QUESTION", ... })`.

### 3.2 Modificar `background/messageRouter.js` y `content/content.js`
**Objetivo:** Pasar los parámetros desde el Side Panel hasta el DOM Scraper.
*   **Acción (`messageRouter.js`):** En `handleProcessQuestion`, recibir los parámetros Anti-Bot y enviarlos en el `chrome.tabs.sendMessage`.
*   **Acción (`content.js`):** En el listener de `ASK_QUESTION`, recibir los nuevos parámetros y pasarlos a la función `askQuestion(..., antiBotConfig)`.

---

## 🤖 FASE 4: Core Anti-Bot (Simulación Humana en la página)

### 4.1 Modificar `content/questionSubmitter.js`
**Objetivo:** Implementar el tecleo humano y el clic natural.
*   **Acción (Modificar `inputQuestion`):**
    *   Recibir el parámetro `antiBotConfig`.
    *   Si `humanTyping` es `true`:
        *   Limpiar el input (`innerHTML = ""`).
        *   Iterar sobre el string `question` carácter por carácter.
        *   Insertar el carácter y disparar secuencialmente: `keydown`, `keypress`, `input`, `keyup`.
        *   Hacer un `await SharedUtils.randomSleep()` entre caracteres. Usar micro-pausas aleatorias del 5% simulando "pausas para pensar".
    *   Si `humanTyping` es `false`, usar el método anterior de inyección directa.
*   **Acción (Modificar `clickElement` / `submitQuestion`):**
    *   En lugar de hacer `.click()` directo, calcular un punto aleatorio dentro del *bounding box* (BoundingClientRect) del botón.
    *   Disparar eventos de ratón en este orden simulando retrasos:
        1.  `mousemove` (al punto aleatorio calculado).
        2.  Pausa de 50-100ms.
        3.  `mousedown`.
        4.  Pausa de 20-80ms (duración del clic).
        5.  `mouseup`.
        6.  `click`.

### 4.2 Reemplazar tiempos estáticos en `content/`
**Objetivo:** Eliminar el rastro robótico de las esperas exactas.
*   **Acción:** Buscar todos los usos de `sleep(200)`, `sleep(500)`, `sleep(1000)` en `questionSubmitter.js`, `webSearchEnabler.js`, y `content.js`.
*   **Acción:** Reemplazarlos por `SharedUtils.randomSleep(min, max)` usando rangos lógicos o basados en `CONFIG.TIMING`.

---

## ✅ Criterios de Aceptación (Checklist para el Agente)
- [ ] La interfaz de la extensión muestra una sección "Anti-Bot".
- [ ] El usuario puede activar/desactivar el tipeo humano y las pausas biológicas.
- [ ] Las preferencias se guardan y persisten al recargar la extensión (`storageService.js`).
- [ ] El envío de texto ya no es instantáneo, sino que dispara eventos de teclado carácter por carácter si la opción está activa.
- [ ] Las esperas entre preguntas varían en milisegundos y no son siempre exactas.
- [ ] El bot se "toma un descanso" automático según el número de preguntas configuradas.
```