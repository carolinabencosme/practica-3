import React from 'react';
import { createRoot } from 'react-dom/client';
import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client/dist/sockjs';
import { motion } from 'framer-motion';
import {
  LineChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Line,
  ResponsiveContainer
} from 'recharts';
import './styles.css';

const MAX_POINTS = 60;

const restBase = import.meta.env.VITE_BACKEND_BASE_URL || '';
const wsEndpoint = import.meta.env.VITE_WEBSOCKET_URL || '/ws';

function toDeviceId(reading = {}) {
  const raw =
    reading.deviceId ??
    reading.idDispositivo ??
    reading.IdDispositivo ??
    reading.deviceID;

  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : null;
}

function toTimestamp(reading = {}) {
  return (
    reading.timestamp ||
    reading.generatedAt ||
    reading.fechaGeneracion ||
    reading.fechaGeneración ||
    reading.time ||
    new Date().toISOString()
  );
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeReading(raw = {}) {
  const deviceId = toDeviceId(raw);

  return {
    deviceId,
    timestamp: toTimestamp(raw),
    temperatura: toNumber(raw.temperatura ?? raw.temperature),
    humedad: toNumber(raw.humedad ?? raw.humidity)
  };
}

function addReading(state, reading) {
  if (reading.deviceId == null) {
    return state;
  }

  const current = state[reading.deviceId] || [];
  const updated = [...current, reading].slice(-MAX_POINTS);
  return {
    ...state,
    [reading.deviceId]: updated
  };
}

function formatChartData(deviceReadings) {
  return deviceReadings.map((r) => ({
    ...r,
    hora: new Date(r.timestamp).toLocaleTimeString()
  }));
}

function parseWsMessage(message) {
  if (!message?.body) {
    return null;
  }

  try {
    const payload = JSON.parse(message.body);
    if (Array.isArray(payload)) {
      return payload.map(normalizeReading);
    }
    return [normalizeReading(payload)];
  } catch (error) {
    console.error('Error parseando mensaje WS', error);
    return null;
  }
}

function formatStatusLabel(connected) {
  return connected ? 'conectado' : 'desconectado';
}

function formatRelativeTime(timestamp, nowMs) {
  if (!timestamp) {
    return 'sin actividad reciente';
  }

  const diffMs = Math.max(0, nowMs - new Date(timestamp).getTime());
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 5) {
    return 'justo ahora';
  }
  if (seconds < 60) {
    return `hace ${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `hace ${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  return `hace ${hours} h`;
}

function Dashboard() {
  const [readingsByDevice, setReadingsByDevice] = React.useState({});
  const [nowMs, setNowMs] = React.useState(Date.now());
  const [status, setStatus] = React.useState({
    backendConnected: false,
    websocketConnected: false,
    lastReading: null,
    error: null
  });

  React.useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  React.useEffect(() => {
    let active = true;

    const loadInitialReadings = async () => {
      try {
        const response = await fetch(`${restBase}/api/readings/recent`);
        if (!response.ok) {
          throw new Error(`Error HTTP ${response.status}`);
        }

        const payload = await response.json();
        const normalized = (Array.isArray(payload) ? payload : []).map(normalizeReading);

        if (!active) {
          return;
        }

        setReadingsByDevice(() => {
          let nextState = {};
          normalized.forEach((reading) => {
            nextState = addReading(nextState, reading);
          });
          return nextState;
        });

        setStatus((prev) => ({
          ...prev,
          backendConnected: true,
          error: null,
          lastReading: normalized.at(-1) || prev.lastReading
        }));
      } catch (error) {
        if (!active) {
          return;
        }

        setStatus((prev) => ({
          ...prev,
          backendConnected: false,
          error: `No se pudo cargar histórico: ${error.message}`
        }));
      }
    };

    loadInitialReadings();

    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    const client = new Client({
      reconnectDelay: 3000,
      webSocketFactory: () => new SockJS(`${restBase}${wsEndpoint}`),
      onConnect: () => {
        setStatus((prev) => ({ ...prev, websocketConnected: true, error: null }));
        client.subscribe('/topic/readings', (message) => {
          const readings = parseWsMessage(message);
          if (!readings) {
            return;
          }

          setReadingsByDevice((prev) => {
            let next = prev;
            readings.forEach((reading) => {
              next = addReading(next, reading);
            });
            return next;
          });

          setStatus((prev) => ({
            ...prev,
            backendConnected: true,
            lastReading: readings.at(-1) || prev.lastReading
          }));
        });
      },
      onStompError: (frame) => {
        setStatus((prev) => ({
          ...prev,
          websocketConnected: false,
          error: `Broker error: ${frame.headers.message || 'desconocido'}`
        }));
      },
      onWebSocketClose: () => {
        setStatus((prev) => ({ ...prev, websocketConnected: false }));
      },
      onWebSocketError: () => {
        setStatus((prev) => ({
          ...prev,
          websocketConnected: false,
          error: 'No se pudo conectar al WebSocket'
        }));
      }
    });

    client.activate();

    return () => {
      client.deactivate();
    };
  }, []);

  const deviceIds = Object.keys(readingsByDevice).sort();
  const allReadings = Object.values(readingsByDevice).flat();
  const totalPoints = allReadings.length;
  const avgTemperature = totalPoints
    ? (allReadings.reduce((acc, item) => acc + (item.temperatura ?? 0), 0) / totalPoints).toFixed(2)
    : null;
  const avgHumidity = totalPoints
    ? (allReadings.reduce((acc, item) => acc + (item.humedad ?? 0), 0) / totalPoints).toFixed(2)
    : null;
  const lastRelative = formatRelativeTime(status.lastReading?.timestamp, nowMs);

  return (
    <main className="app">
      <div className="glow glow-top" />
      <div className="glow glow-bottom" />

      <header className="hero">
        <p className="eyebrow">Telemetry Control Center</p>
        <h1>Dashboard de Telemetría</h1>
        <p className="hero-subtitle">Monitoreo en tiempo real por sensor • stack JMS + WebSocket + PostgreSQL</p>
      </header>

      <motion.section
        className="status-panel"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
      >
        <h2>Estado del sistema</h2>
        <div className="status-grid">
          <div className="status-chip">
            <span className={`dot ${status.backendConnected ? 'ok' : 'bad'}`} />
            <strong>Backend REST</strong>
            <span>{formatStatusLabel(status.backendConnected)}</span>
          </div>
          <div className="status-chip">
            <span className={`dot ${status.websocketConnected ? 'ok' : 'bad'}`} />
            <strong>Broker/WebSocket</strong>
            <span>{formatStatusLabel(status.websocketConnected)}</span>
          </div>
          <div className="status-chip metric">
            <strong>Sensores activos</strong>
            <span>{deviceIds.length}</span>
          </div>
          <div className="status-chip metric">
            <strong>Puntos en memoria</strong>
            <span>{totalPoints}</span>
          </div>
        </div>

        <div className="kpi-grid">
          <motion.article className="kpi-card" whileHover={{ y: -3 }} transition={{ duration: 0.2 }}>
            <p>Promedio temperatura</p>
            <h3>{avgTemperature !== null ? `${avgTemperature} °C` : '--'}</h3>
          </motion.article>
          <motion.article className="kpi-card" whileHover={{ y: -3 }} transition={{ duration: 0.2 }}>
            <p>Promedio humedad</p>
            <h3>{avgHumidity !== null ? `${avgHumidity} %` : '--'}</h3>
          </motion.article>
          <motion.article className="kpi-card" whileHover={{ y: -3 }} transition={{ duration: 0.2 }}>
            <p>Última actualización</p>
            <h3>{lastRelative}</h3>
          </motion.article>
        </div>

        <p className="last-reading">
          Última lectura:{' '}
          {status.lastReading
            ? `${status.lastReading.deviceId} @ ${new Date(status.lastReading.timestamp).toLocaleString()}`
            : 'Sin datos'}
        </p>

        {status.error && <p className="error">{status.error}</p>}
      </motion.section>

      {deviceIds.length === 0 && <p className="empty">No hay lecturas disponibles todavía.</p>}

      {deviceIds.map((deviceId, idx) => {
        const chartData = formatChartData(readingsByDevice[deviceId]);

        return (
          <motion.section
            className="device-card"
            key={deviceId}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: Math.min(idx * 0.08, 0.32), ease: 'easeOut' }}
          >
            <div className="device-header">
              <h3>Sensor {deviceId}</h3>
              <span>{chartData.length} puntos</span>
            </div>

            <motion.div className="chart-block" whileHover={{ scale: 1.005 }} transition={{ duration: 0.2 }}>
              <h4>Temperatura vs tiempo</h4>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(146, 165, 189, 0.22)" />
                  <XAxis dataKey="hora" stroke="#8fa5be" />
                  <YAxis unit="°C" stroke="#8fa5be" />
                  <Tooltip
                    contentStyle={{
                      background: 'rgba(30, 39, 46, 0.96)',
                      border: '1px solid rgba(0, 206, 201, 0.35)',
                      color: '#f5f6fa'
                    }}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="temperatura"
                    stroke="#00cec9"
                    strokeWidth={2.5}
                    activeDot={{ r: 5 }}
                    dot={chartData.length < 2}
                    name="Temperatura"
                  />
                </LineChart>
              </ResponsiveContainer>
            </motion.div>

            <motion.div className="chart-block" whileHover={{ scale: 1.005 }} transition={{ duration: 0.2 }}>
              <h4>Humedad vs tiempo</h4>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(146, 165, 189, 0.22)" />
                  <XAxis dataKey="hora" stroke="#8fa5be" />
                  <YAxis unit="%" stroke="#8fa5be" />
                  <Tooltip
                    contentStyle={{
                      background: 'rgba(30, 39, 46, 0.96)',
                      border: '1px solid rgba(9, 132, 227, 0.35)',
                      color: '#f5f6fa'
                    }}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="humedad"
                    stroke="#0984e3"
                    strokeWidth={2.5}
                    activeDot={{ r: 5 }}
                    dot={chartData.length < 2}
                    name="Humedad"
                  />
                </LineChart>
              </ResponsiveContainer>
            </motion.div>
          </motion.section>
        );
      })}
    </main>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Dashboard />
  </React.StrictMode>
);
