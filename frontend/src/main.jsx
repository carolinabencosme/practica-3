import React from 'react';
import { createRoot } from 'react-dom/client';
import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client/dist/sockjs';
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
  return (
    reading.deviceId ||
    reading.idDispositivo ||
    reading.IdDispositivo ||
    reading.deviceID ||
    'desconocido'
  );
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
  return {
    deviceId: toDeviceId(raw),
    timestamp: toTimestamp(raw),
    temperatura: toNumber(raw.temperatura ?? raw.temperature),
    humedad: toNumber(raw.humedad ?? raw.humidity)
  };
}

function addReading(state, reading) {
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

function Dashboard() {
  const [readingsByDevice, setReadingsByDevice] = React.useState({});
  const [status, setStatus] = React.useState({
    backendConnected: false,
    websocketConnected: false,
    lastReading: null,
    error: null
  });

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

  return (
    <main className="app">
      <header>
        <h1>Dashboard de Telemetría</h1>
        <p>Monitoreo en tiempo real por sensor</p>
      </header>

      <section className="status-panel">
        <h2>Estado del sistema</h2>
        <ul>
          <li>Backend REST: {status.backendConnected ? '✅ conectado' : '❌ desconectado'}</li>
          <li>Broker/WebSocket: {status.websocketConnected ? '✅ conectado' : '❌ desconectado'}</li>
          <li>
            Última lectura:{' '}
            {status.lastReading
              ? `${status.lastReading.deviceId} @ ${new Date(status.lastReading.timestamp).toLocaleString()}`
              : 'Sin datos'}
          </li>
        </ul>
        {status.error && <p className="error">{status.error}</p>}
      </section>

      {deviceIds.length === 0 && <p>No hay lecturas disponibles todavía.</p>}

      {deviceIds.map((deviceId) => {
        const chartData = formatChartData(readingsByDevice[deviceId]);

        return (
          <section className="device-card" key={deviceId}>
            <h3>Sensor: {deviceId}</h3>

            <div className="chart-block">
              <h4>Temperatura vs tiempo</h4>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="hora" />
                  <YAxis unit="°C" />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="temperatura" stroke="#ef4444" dot={false} name="Temperatura" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="chart-block">
              <h4>Humedad vs tiempo</h4>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="hora" />
                  <YAxis unit="%" />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="humedad" stroke="#3b82f6" dot={false} name="Humedad" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
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
