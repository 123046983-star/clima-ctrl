# Clima Ctrl: dashboard del aire acondicionado por MQTT

Usa la misma tecnología que el *Blower Controller* de Cristo: PWA con HTML + CSS + JavaScript puro y
[mqtt.js](https://github.com/mqttjs/MQTT.js) por WebSocket seguro al broker público de HiveMQ.

**En línea:** https://123046983-star.github.io/clima-ctrl/
(simulador: https://123046983-star.github.io/clima-ctrl/simulador.html)

## Instalar en iPhone (como app)
1. Abre el enlace en **Safari** (en iOS solo Safari puede instalar apps web).
2. Botón **Compartir** (cuadro con flecha) → **Agregar a inicio** → **Agregar**.
3. Queda un ícono "Clima Ctrl" en la pantalla de inicio; abre en pantalla completa, sin barra de Safari.

En Android: Chrome → menú ⋮ → **Instalar app**.

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

## Firmware del ESP32 (`firmware/ClimaCtrl`)
Manda las órdenes al minisplit por **infrarrojo**, imitando al control remoto, así que no hay que
abrir el equipo. Compila sin errores para "ESP32 Dev Module" (usa el 83 % de la flash).

Material: ESP32 DevKit, LED infrarrojo de 940 nm, transistor 2N2222, resistencias de 100 Ω y 1 kΩ,
sensor DHT22 y resistencia de 10 kΩ.

| Señal | Pin del ESP32 |
|---|---|
| LED IR (por el 2N2222: base con 1 kΩ al GPIO 4; LED + 100 Ω entre 5 V y el colector; emisor a GND) | GPIO 4 |
| DHT22 dato (con 10 kΩ a 3.3 V) | GPIO 15 |
| DHT22 VCC / GND | 3.3 V / GND |

Pasos:
1. En `config.h` pon tu Wi-Fi (2.4 GHz), el mismo `DEVICE_ID` de la app y la **marca del minisplit**
   (`AC_PROTOCOL`: GREE, MIDEA, LG, SAMSUNG_AC, MIRAGE…). Si no la sabes, carga el ejemplo
   `IRrecvDumpV2` con un receptor IR y apunta el control original: te dice el protocolo.
2. Librerías: PubSubClient, ArduinoJson 7, IRremoteESP8266, DHT sensor library, Adafruit Unified Sensor.
3. Placa "ESP32 Dev Module" y subir. El monitor serie (115200) muestra la conexión y cada orden IR.
4. Apunta el LED IR al minisplit (a 1–3 m, con línea de vista).

Al infrarrojo no le contesta el equipo, así que la telemetría refleja la **última orden enviada**.
Si alguien usa el control original, la app no se entera.

## Notas
- El broker público `broker.hivemq.com` lo puede leer cualquiera que conozca el tópico. Para algo
  más que pruebas, usa un ID difícil de adivinar o un broker propio con usuario y contraseña.
- Para usarlo en el celular hay que subirlo a un hosting con https (por ejemplo GitHub Pages,
  como hizo Cristo); abierto como archivo local funciona, pero no se puede instalar como app.
