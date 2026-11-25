#pragma once
// ─────────────────────────────────────────────────────────────────────────────
//  Configuración: cambia esto antes de subir el programa al ESP32
// ─────────────────────────────────────────────────────────────────────────────

// Wi-Fi (solo redes de 2.4 GHz)
#define WIFI_SSID     "TU_RED_WIFI"
#define WIFI_PASS     "TU_CONTRASENA"

// MQTT: mismo broker que el dashboard (el ESP32 usa TCP 1883; el navegador usa wss 8884)
#define MQTT_HOST     "broker.hivemq.com"
#define MQTT_PORT     1883
#define DEVICE_ID     "AC-CTRL-7F3A2C"      // debe ser igual al de Ajustes en la app

// Pines
#define PIN_IR_LED    4     // LED infrarrojo (con transistor 2N2222 + resistencia de 100 ohm)
#define PIN_DHT       15    // Sensor DHT22 (dato), con resistencia pull-up de 10 kohm
#define PIN_LED       2     // LED integrado: parpadea al recibir un comando

// Marca del minisplit (protocolo IR de la librería IRremoteESP8266).
// Ejemplos: GREE, MIDEA, LG, SAMSUNG_AC, DAIKIN, MITSUBISHI_AC, PANASONIC_AC,
//           HAIER_AC, TCL112AC, MIRAGE, CARRIER_AC64, WHIRLPOOL_AC, HISENSE...
// Si no sabes cuál es, carga el ejemplo "IRrecvDumpV2" de la librería, apunta el
// control original a un receptor IR y te dice el protocolo.
#define AC_PROTOCOL   decode_type_t::GREE
#define AC_MODEL      1     // algunos protocolos tienen variantes; 1 sirve casi siempre

// Cada cuánto se manda la telemetría (ms)
#define TELEMETRY_MS  2000
