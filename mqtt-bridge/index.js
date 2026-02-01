/**
 * MQTT Bridge Service
 *
 * HTTP endpoint that receives commands from Directus Flow
 * and publishes them to MQTT broker for ESP32 devices.
 * Also polls Directus for pending commands as a fallback.
 *
 * Endpoints:
 *   POST /api/mqtt/publish - Publish command to device
 *   GET /health - Health check
 */

const express = require('express');
const mqtt = require('mqtt');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'http://localhost:8055';
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL) || 3000;

// Axios instance for Directus API
const directusApi = DIRECTUS_TOKEN ? axios.create({
  baseURL: DIRECTUS_URL,
  headers: {
    'Authorization': `Bearer ${DIRECTUS_TOKEN}`,
    'Content-Type': 'application/json'
  },
  timeout: 5000
}) : null;

// MQTT connection with auto-reconnect
const mqttClient = mqtt.connect(process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883', {
  username: process.env.MQTT_USERNAME || undefined,
  password: process.env.MQTT_PASSWORD || undefined,
  clientId: `directus-bridge-${Date.now()}`,
  reconnectPeriod: 5000,
  connectTimeout: 30000
});

let mqttConnected = false;

mqttClient.on('connect', () => {
  mqttConnected = true;
  console.log('[MQTT Bridge] Connected to broker');
});

mqttClient.on('error', (err) => {
  console.error('[MQTT Bridge] Error:', err.message);
});

mqttClient.on('close', () => {
  mqttConnected = false;
  console.log('[MQTT Bridge] Disconnected from broker');
});

mqttClient.on('reconnect', () => {
  console.log('[MQTT Bridge] Reconnecting...');
});

// Auth middleware - validate bridge secret
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const secret = process.env.BRIDGE_SECRET;

  if (!secret) {
    console.warn('[MQTT Bridge] BRIDGE_SECRET not set, allowing all requests');
    return next();
  }

  if (token !== secret) {
    console.warn('[MQTT Bridge] Unauthorized request');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// Publish MQTT message helper
function publishToMqtt(topic, payload) {
  return new Promise((resolve, reject) => {
    if (!mqttConnected) {
      return reject(new Error('MQTT broker not connected'));
    }
    const message = typeof payload === 'string' ? payload : JSON.stringify(payload);
    mqttClient.publish(topic, message, { qos: 1 }, (err) => {
      if (err) return reject(err);
      console.log(`[MQTT Bridge] Published to ${topic}:`, payload.type || 'unknown');
      resolve();
    });
  });
}

// Publish endpoint - receives command from Directus Flow
app.post('/api/mqtt/publish', authMiddleware, async (req, res) => {
  const { topic, payload } = req.body;

  if (!topic) return res.status(400).json({ error: 'Missing topic' });
  if (!payload) return res.status(400).json({ error: 'Missing payload' });

  try {
    await publishToMqtt(topic, payload);
    res.json({ success: true, topic, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[MQTT Bridge] Publish failed:', err.message);
    const status = err.message.includes('not connected') ? 503 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: mqttConnected ? 'ok' : 'degraded',
    mqtt: mqttConnected ? 'connected' : 'disconnected',
    polling: directusApi ? 'active' : 'disabled',
    timestamp: new Date().toISOString()
  });
});

// ===== POLLING: Fallback for unreliable Directus Flow =====
let isPolling = false;

// Track recently published commands to avoid duplicate publishes
// Key: command_id, Value: timestamp when published
const recentlyPublished = new Map();
const PUBLISH_COOLDOWN = 30000; // 30 seconds before re-publishing same command

// Clean up old entries every minute
setInterval(() => {
  const now = Date.now();
  for (const [id, timestamp] of recentlyPublished) {
    if (now - timestamp > PUBLISH_COOLDOWN) {
      recentlyPublished.delete(id);
    }
  }
}, 60000);

async function pollPendingCommands() {
  if (!directusApi || !mqttConnected || isPolling) return;
  isPolling = true;

  try {
    // Fetch pending commands with device info
    const { data } = await directusApi.get('/items/device_commands', {
      params: {
        'filter[status][_eq]': 'pending',
        'fields': 'id,command_type,fingerprint_id,member_id,device_id.id,device_id.device_mac,device_id.device_name,date_created',
        'sort': 'date_created',
        'limit': 10
      }
    });

    const commands = data.data || [];
    if (commands.length === 0) return;

    console.log(`[MQTT Bridge] Polling found ${commands.length} pending command(s)`);

    for (const cmd of commands) {
      // Skip if recently published (within cooldown period)
      if (recentlyPublished.has(cmd.id)) {
        continue;
      }

      const deviceMac = cmd.device_id?.device_mac;
      if (!deviceMac) {
        console.warn(`[MQTT Bridge] Command ${cmd.id} has no device_mac, skipping`);
        // Mark as failed
        await directusApi.patch(`/items/device_commands/${cmd.id}`, {
          status: 'failed',
          error_message: 'Device has no MAC address configured'
        }).catch(() => {});
        continue;
      }

      const topic = `device/${deviceMac}/commands`;
      const payload = {
        command_id: cmd.id,
        type: cmd.command_type,
        params: {
          fingerprint_id: cmd.fingerprint_id,
          member_id: cmd.member_id
        },
        timestamp: cmd.date_created
      };

      try {
        await publishToMqtt(topic, payload);

        // Track this command to avoid duplicate publishes
        recentlyPublished.set(cmd.id, Date.now());

        // NOTE: Do NOT update status here. Status will be updated by mqtt-subscriber
        // when ESP32 sends ACK (processing/completed/failed).

        console.log(`[MQTT Bridge] Command ${cmd.id} (${cmd.command_type}) → ${deviceMac}`);
      } catch (err) {
        console.error(`[MQTT Bridge] Failed to publish command ${cmd.id}:`, err.message);
      }
    }
  } catch (err) {
    if (err.code !== 'ECONNREFUSED') {
      console.error('[MQTT Bridge] Poll error:', err.message);
    }
  } finally {
    isPolling = false;
  }
}

// Start polling if Directus token is configured
if (directusApi) {
  console.log(`[MQTT Bridge] Polling enabled (every ${POLL_INTERVAL}ms)`);
  setInterval(pollPendingCommands, POLL_INTERVAL);
} else {
  console.log('[MQTT Bridge] Polling disabled (no DIRECTUS_TOKEN)');
}

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[MQTT Bridge] Running on port ${PORT}`);
  console.log(`[MQTT Bridge] Connecting to ${process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883'}`);
});
