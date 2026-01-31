# MQTT Services

Backend services for ESP32 device command management via MQTT.

## Services

### mqtt-bridge (Port 3001)
HTTP-to-MQTT bridge. Receives commands from Directus Flow and publishes to MQTT broker.

### mqtt-subscriber
Listens for device status updates via MQTT and updates Directus `device_commands` records.

## Setup

```bash
# Install dependencies
cd mqtt-bridge && npm install
cd ../mqtt-subscriber && npm install

# Configure environment
cp mqtt-bridge/.env.example mqtt-bridge/.env
cp mqtt-subscriber/.env.example mqtt-subscriber/.env
# Edit .env files with your settings
```

## Environment Variables

### mqtt-bridge/.env
```
MQTT_BROKER_URL=mqtt://localhost:1883
MQTT_USERNAME=
MQTT_PASSWORD=
BRIDGE_SECRET=your-secret-here
PORT=3001
```

### mqtt-subscriber/.env
```
MQTT_BROKER_URL=mqtt://localhost:1883
MQTT_USERNAME=
MQTT_PASSWORD=
DIRECTUS_URL=http://localhost:8055
DIRECTUS_TOKEN=your-static-token
```

### Directus .env (add these)
```
MQTT_BRIDGE_URL=http://localhost:3001
MQTT_BRIDGE_SECRET=your-secret-here
```

## Running with PM2

```bash
pm2 start mqtt-bridge/index.js --name mqtt-bridge
pm2 start mqtt-subscriber/index.js --name mqtt-subscriber
pm2 save
pm2 startup
```

## Architecture

```
Directus Flow (on command create)
    ↓
mqtt-bridge (HTTP POST /api/mqtt/publish)
    ↓
Mosquitto Broker (device/{mac}/commands)
    ↓
ESP32 Device
    ↓
Mosquitto Broker (device/{mac}/status)
    ↓
mqtt-subscriber (updates Directus)
```
