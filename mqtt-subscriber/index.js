/**
 * MQTT Subscriber Service
 *
 * Listens to ESP32 device status updates via MQTT
 * and updates device_commands records in Directus.
 *
 * Subscribed Topics:
 *   device/+/status - Device status updates (wildcard for all MACs)
 *
 * Expected Payload:
 *   {
 *     command_id: "uuid",
 *     status: "completed" | "failed" | "processing",
 *     result: { ... },
 *     error_message: "string" | null
 *   }
 */

const mqtt = require('mqtt');
const axios = require('axios');
require('dotenv').config();

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'http://localhost:8055';
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;

if (!DIRECTUS_TOKEN) {
  console.error('[MQTT Subscriber] ERROR: DIRECTUS_TOKEN not set');
  process.exit(1);
}

// Axios instance for Directus API
const directusApi = axios.create({
  baseURL: DIRECTUS_URL,
  headers: {
    'Authorization': `Bearer ${DIRECTUS_TOKEN}`,
    'Content-Type': 'application/json'
  }
});

// MQTT connection with auto-reconnect
const mqttClient = mqtt.connect(process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883', {
  username: process.env.MQTT_USERNAME || undefined,
  password: process.env.MQTT_PASSWORD || undefined,
  clientId: `directus-subscriber-${Date.now()}`,
  reconnectPeriod: 5000,
  connectTimeout: 30000
});

mqttClient.on('connect', () => {
  console.log('[MQTT Subscriber] Connected to broker');

  // Subscribe to all device status topics (wildcard +)
  mqttClient.subscribe('device/+/status', { qos: 1 }, (err) => {
    if (err) {
      console.error('[MQTT Subscriber] Subscribe failed:', err.message);
    } else {
      console.log('[MQTT Subscriber] Subscribed to: device/+/status');
    }
  });
});

mqttClient.on('error', (err) => {
  console.error('[MQTT Subscriber] Error:', err.message);
});

mqttClient.on('close', () => {
  console.log('[MQTT Subscriber] Disconnected from broker');
});

mqttClient.on('reconnect', () => {
  console.log('[MQTT Subscriber] Reconnecting...');
});

// Handle incoming MQTT messages
mqttClient.on('message', async (topic, message) => {
  try {
    // Parse topic: device/{mac}/status
    const topicParts = topic.split('/');
    const deviceMac = topicParts[1];

    // Parse payload
    const payload = JSON.parse(message.toString());
    const { command_id, status, result, error_message } = payload;

    // Skip messages without command_id (could be heartbeat or other messages)
    if (!command_id) {
      console.log(`[MQTT Subscriber] Skipping message without command_id from ${deviceMac}`);
      return;
    }

    // Validate status value
    const validStatuses = ['processing', 'completed', 'failed'];
    if (!validStatuses.includes(status)) {
      console.warn(`[MQTT Subscriber] Invalid status "${status}" for command ${command_id}`);
      return;
    }

    console.log(`[MQTT Subscriber] Status update: ${command_id} -> ${status}`);

    // Update Directus device_commands record
    const updateData = {
      status,
      result: result || null,
      error_message: error_message || null,
      executed_at: new Date().toISOString()
    };

    await directusApi.patch(`/items/device_commands/${command_id}`, updateData);

    console.log(`[MQTT Subscriber] Updated command ${command_id}: ${status}`);

  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('[MQTT Subscriber] Directus API error:', error.response?.status, error.response?.data?.errors?.[0]?.message || error.message);
    } else if (error instanceof SyntaxError) {
      console.error('[MQTT Subscriber] Invalid JSON payload:', message.toString().substring(0, 100));
    } else {
      console.error('[MQTT Subscriber] Error processing message:', error.message);
    }
  }
});

console.log('[MQTT Subscriber] Starting...');
console.log(`[MQTT Subscriber] Directus URL: ${DIRECTUS_URL}`);
console.log(`[MQTT Subscriber] MQTT Broker: ${process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883'}`);
