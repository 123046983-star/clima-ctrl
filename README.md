# Clima Ctrl: dashboard del aire acondicionado por MQTT

Usa la misma tecnología que el *Blower Controller* de Cristo: PWA con HTML + CSS + JavaScript puro y
[mqtt.js](https://github.com/mqttjs/MQTT.js) por WebSocket seguro al broker público de HiveMQ.

## Archivos
| Archivo | Qué es |
|---|---|
| `index.html`, `styles.css`, `app.js` | El dashboard |
| `manifest.json`, `service-worker.js`, `icon.svg` | Para instalarlo como app en el celular (PWA) |
| `simulador.html` | Hace de equipo (ESP32 + minisplit) para probar sin hardware |
| `referencia-cristo/` | Copia de la app original de Cristo, solo como referencia |

## Probarlo en la laptop
1. Abre `simulador.html` y presiona **Conectar simulador**.
2. Abre `index.html` y presiona **Conectar**.
3. Mueve lo que quieras: el simulador recibe el comando, lo aplica y lo confirma con su telemetría.
   Si marcas "Ignorar comandos" en el simulador, el dashboard regresa al estado anterior y muestra
   "No se pudo…" a los 5 s (igual que en la app de Cristo).

`index.html#auto` y `simulador.html#auto` se conectan solos al abrir.

## Contrato MQTT (lo que tiene que hacer el ESP32)
ID por defecto: `AC-CTRL-7F3A2C` (se cambia en ⚙ Ajustes; se guarda en el navegador).

**Telemetría** (equipo → app), cada 1–2 s y justo después de aplicar un comando:
`clima/ctrl/AC-CTRL-7F3A2C/telemetry`
```json
{"power":true,"mode":"cool","setpoint":24,"fan":"auto","swing":false,
 "temp":26.4,"hum":55,"running":true}
```
- `mode`: `auto` | `cool` | `heat` | `dry` | `fan`
- `fan`: `"auto"` | `1` | `2` | `3`
- `setpoint`: 16–30 °C (entero)
- `running`: si el compresor está trabajando (opcional; la app muestra "En espera")

**Comandos** (app → equipo), JSON parcial, solo con lo que cambia:
`clima/ctrl/AC-CTRL-7F3A2C/command`
```json
{"power":false}
{"setpoint":23}
{"mode":"heat","power":true}
{"fan":2}
{"swing":true}
```
Un comando cuenta como hecho cuando la telemetría trae el valor nuevo; si no llega en 5 s,
la app regresa al valor confirmado y avisa.

## Notas
- El broker público `broker.hivemq.com` lo puede leer cualquiera que conozca el tópico. Para algo
  más que pruebas, usa un ID difícil de adivinar o un broker propio con usuario y contraseña.
- Para usarlo en el celular hay que subirlo a un hosting con https (por ejemplo GitHub Pages,
  como hizo Cristo); abierto como archivo local funciona, pero no se puede instalar como app.
