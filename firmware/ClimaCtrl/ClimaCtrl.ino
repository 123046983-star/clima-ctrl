/*
  Clima Ctrl: firmware del ESP32 para el dashboard de aire acondicionado.

  - Recibe comandos JSON por MQTT y los manda al minisplit por infrarrojo,
    como si fuera el control remoto (librería IRremoteESP8266).
  - Lee temperatura y humedad del cuarto con un DHT22.
  - Publica la telemetría cada 2 s y justo después de aplicar cada comando
    (así el dashboard confirma el cambio).
  - Guarda el último estado en la memoria flash, para recuperarlo tras un apagón.

  Tópicos (DEVICE_ID en config.h):
    clima/ctrl/<ID>/command    app → equipo   {"power":true} {"setpoint":23} {"mode":"heat"} {"fan":2} {"swing":true}
    clima/ctrl/<ID>/telemetry  equipo → app   {"power":true,"mode":"cool","setpoint":24,"fan":"auto","swing":false,"temp":26.4,"hum":55}
    clima/ctrl/<ID>/status     "online"/"offline" (retenido; offline lo manda el broker si el ESP32 se desconecta)

  Librerías (Gestor de librerías del IDE de Arduino):
    PubSubClient (Nick O'Leary), ArduinoJson 7.x (Benoit Blanchon),
    IRremoteESP8266 (David Conran), DHT sensor library + Adafruit Unified Sensor (Adafruit)
  Placa: "ESP32 Dev Module" (paquete esp32 de Espressif).
*/

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <IRremoteESP8266.h>
#include <IRac.h>
#include <DHT.h>
#include "config.h"

// ── Tópicos ─────────────────────────────────────────────────────────────────
const String TOPIC_BASE  = String("clima/ctrl/") + DEVICE_ID;
const String TOPIC_CMD   = TOPIC_BASE + "/command";
const String TOPIC_TELE  = TOPIC_BASE + "/telemetry";
const String TOPIC_STAT  = TOPIC_BASE + "/status";

// ── Estado del aire ─────────────────────────────────────────────────────────
struct AcState {
  bool    power    = false;
  String  mode     = "cool";   // auto | cool | heat | dry | fan
  int     setpoint = 24;       // 16–30 °C
  int     fan      = 0;        // 0 = auto, 1–3
  bool    swing    = false;
} st;

float roomTemp = NAN, roomHum = NAN;

WiFiClient   net;
PubSubClient mqtt(net);
Preferences  prefs;
IRac         ac(PIN_IR_LED);
DHT          dht(PIN_DHT, DHT22);

unsigned long lastTele = 0, lastSensor = 0, lastMqttTry = 0, ledOffAt = 0;

// ── Memoria flash ───────────────────────────────────────────────────────────
void loadState() {
  prefs.begin("clima", true);
  st.power    = prefs.getBool("power", false);
  st.mode     = prefs.getString("mode", "cool");
  st.setpoint = prefs.getInt("set", 24);
  st.fan      = prefs.getInt("fan", 0);
  st.swing    = prefs.getBool("swing", false);
  prefs.end();
}

void saveState() {
  prefs.begin("clima", false);
  prefs.putBool("power", st.power);
  prefs.putString("mode", st.mode);
  prefs.putInt("set", st.setpoint);
  prefs.putInt("fan", st.fan);
  prefs.putBool("swing", st.swing);
  prefs.end();
}

// ── Infrarrojo ──────────────────────────────────────────────────────────────
stdAc::opmode_t toOpMode(const String &m) {
  if (m == "auto") return stdAc::opmode_t::kAuto;
  if (m == "heat") return stdAc::opmode_t::kHeat;
  if (m == "dry")  return stdAc::opmode_t::kDry;
  if (m == "fan")  return stdAc::opmode_t::kFan;
  return stdAc::opmode_t::kCool;
}

stdAc::fanspeed_t toFan(int f) {
  switch (f) {
    case 1:  return stdAc::fanspeed_t::kLow;
    case 2:  return stdAc::fanspeed_t::kMedium;
    case 3:  return stdAc::fanspeed_t::kHigh;
    default: return stdAc::fanspeed_t::kAuto;
  }
}

void sendIR() {
  ac.next.protocol = AC_PROTOCOL;
  ac.next.model    = AC_MODEL;
  ac.next.celsius  = true;
  ac.next.power    = st.power;
  ac.next.mode     = toOpMode(st.mode);
  ac.next.degrees  = st.setpoint;
  ac.next.fanspeed = toFan(st.fan);
  ac.next.swingv   = st.swing ? stdAc::swingv_t::kAuto : stdAc::swingv_t::kOff;
  ac.next.swingh   = stdAc::swingh_t::kOff;
  ac.next.light    = true;
  ac.next.beep     = true;
  ac.sendAc();
  Serial.printf("IR -> power=%d mode=%s set=%d fan=%d swing=%d\n",
                st.power, st.mode.c_str(), st.setpoint, st.fan, st.swing);
}

// ── Telemetría ──────────────────────────────────────────────────────────────
void publishTelemetry() {
  if (!mqtt.connected()) return;
  JsonDocument doc;
  doc["power"]    = st.power;
  doc["mode"]     = st.mode;
  doc["setpoint"] = st.setpoint;
  if (st.fan == 0) doc["fan"] = "auto"; else doc["fan"] = st.fan;
  doc["swing"]    = st.swing;
  if (!isnan(roomTemp)) doc["temp"] = roundf(roomTemp * 10) / 10.0;
  if (!isnan(roomHum))  doc["hum"]  = (int)roundf(roomHum);
  char buf[200];
  size_t n = serializeJson(doc, buf);
  mqtt.publish(TOPIC_TELE.c_str(), (const uint8_t *)buf, n, false);
}

void readSensor() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (!isnan(t)) roomTemp = t;
  if (!isnan(h)) roomHum  = h;
}

// ── Comandos ────────────────────────────────────────────────────────────────
void onMessage(char *topic, byte *payload, unsigned int len) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, len)) {
    Serial.println("Comando mal formado, se ignora");
    return;
  }
  bool changed = false;

  if (doc["power"].is<bool>()) {
    st.power = doc["power"]; changed = true;
  }
  if (doc["mode"].is<const char *>()) {
    String m = doc["mode"].as<const char *>();
    if (m == "auto" || m == "cool" || m == "heat" || m == "dry" || m == "fan") { st.mode = m; changed = true; }
  }
  if (doc["setpoint"].is<int>()) {
    st.setpoint = constrain(doc["setpoint"].as<int>(), 16, 30); changed = true;
  }
  if (doc["fan"].is<const char *>() && String(doc["fan"].as<const char *>()) == "auto") {
    st.fan = 0; changed = true;
  } else if (doc["fan"].is<int>()) {
    st.fan = constrain(doc["fan"].as<int>(), 1, 3); changed = true;
  }
  if (doc["swing"].is<bool>()) {
    st.swing = doc["swing"]; changed = true;
  }

  if (changed) {
    digitalWrite(PIN_LED, HIGH); ledOffAt = millis() + 150;
    sendIR();
    saveState();
    publishTelemetry();            // confirma de inmediato al dashboard
  }
}

// ── Conexión ────────────────────────────────────────────────────────────────
void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Conectando a Wi-Fi");
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) { delay(500); Serial.print("."); }
  Serial.println(WiFi.status() == WL_CONNECTED ? " OK " + WiFi.localIP().toString() : " sin conexión (reintenta solo)");
}

void ensureMqtt() {
  if (mqtt.connected() || WiFi.status() != WL_CONNECTED) return;
  if (millis() - lastMqttTry < 5000) return;
  lastMqttTry = millis();
  String clientId = String("clima-esp32-") + String((uint32_t)ESP.getEfuseMac(), HEX);
  Serial.print("Conectando a MQTT... ");
  if (mqtt.connect(clientId.c_str(), nullptr, nullptr, TOPIC_STAT.c_str(), 0, true, "offline")) {
    Serial.println("OK");
    mqtt.publish(TOPIC_STAT.c_str(), "online", true);
    mqtt.subscribe(TOPIC_CMD.c_str());
    publishTelemetry();
  } else {
    Serial.printf("falló (estado %d)\n", mqtt.state());
  }
}

// ── Arduino ─────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED, OUTPUT);
  dht.begin();
  loadState();
  connectWiFi();
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMessage);
  mqtt.setBufferSize(512);
  readSensor();
}

void loop() {
  ensureMqtt();
  mqtt.loop();

  unsigned long now = millis();
  if (now - lastSensor >= 2000) { lastSensor = now; readSensor(); }   // el DHT22 no da más de 1 lectura cada 2 s
  if (now - lastTele >= TELEMETRY_MS) { lastTele = now; publishTelemetry(); }
  if (ledOffAt && now > ledOffAt) { digitalWrite(PIN_LED, LOW); ledOffAt = 0; }
}
