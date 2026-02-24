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
  return reading.deviceId || reading.idDispositivo || reading.IdDispositivo || reading.deviceID || 'desconocido';
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

function formatRelativeTime(timestamp, nowMs) {
  if (!timestamp) return 'sin actividad reciente';
  const diffMs = Math.max(0, nowMs - new Date(timestamp).getTime());
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 5) return 'justo ahora';
  if (seconds < 60) return `hace ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  return `hace ${Math.floor(minutes / 60)} h`;
}

function defaultWindowState() {
  return { closed: false, minimized: false, maximized: false };
}

function WindowFrame({
  title,
  accent = 'cyan',
  children,
  className = '',
  state,
  onClose,
  onMinimize,
  onMaximize
}) {
  const windowClass = [
    'window',
    accent,
    className,
    state?.minimized ? 'minimized' : '',
    state?.maximized ? 'maximized' : ''
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className={windowClass}>
      <header className="window-head">
        <div className="window-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <h3>{title}</h3>
        <div className="window-actions">
          <button type="button" className="win-btn" onClick={onMinimize} title="Minimizar">
            −
          </button>
          <button type="button" className="win-btn" onClick={onMaximize} title="Expandir">
            □
          </button>
          <button type="button" className="win-btn close" onClick={onClose} title="Cerrar">
            ×
          </button>
        </div>
      </header>
      {!state?.minimized && <div className="window-body">{children}</div>}
    </section>
  );
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
  const [windowStates, setWindowStates] = React.useState({
    command: defaultWindowState(),
    kpi: defaultWindowState()
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
        if (!active) return;

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
        if (!active) return;
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
          if (!readings) return;

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
    return () => client.deactivate();
  }, []);

  const deviceIds = Object.keys(readingsByDevice).sort();

  React.useEffect(() => {
    setWindowStates((prev) => {
      const next = { ...prev };
      deviceIds.forEach((deviceId) => {
        const key = `sensor-${deviceId}`;
        if (!next[key]) {
          next[key] = defaultWindowState();
        }
      });
      return next;
    });
  }, [deviceIds]);

  const allReadings = Object.values(readingsByDevice).flat();
  const totalPoints = allReadings.length;
  const avgTemperature = totalPoints
    ? (allReadings.reduce((acc, item) => acc + (item.temperatura ?? 0), 0) / totalPoints).toFixed(2)
    : '--';
  const avgHumidity = totalPoints
    ? (allReadings.reduce((acc, item) => acc + (item.humedad ?? 0), 0) / totalPoints).toFixed(2)
    : '--';

  const windowMeta = React.useMemo(() => {
    const base = {
      command: 'Command Center',
      kpi: 'Live KPIs'
    };

    deviceIds.forEach((deviceId) => {
      base[`sensor-${deviceId}`] = `Sensor ${deviceId}`;
    });

    return base;
  }, [deviceIds]);

  const closedWindows = Object.entries(windowStates)
    .filter(([, value]) => value?.closed)
    .map(([id]) => ({ id, title: windowMeta[id] || id }));

  const updateWindow = React.useCallback((id, updater) => {
    setWindowStates((prev) => {
      const current = prev[id] || defaultWindowState();
      return {
        ...prev,
        [id]: updater(current)
      };
    });
  }, []);

  const closeWindow = (id) => updateWindow(id, (curr) => ({ ...curr, closed: true, minimized: false, maximized: false }));
  const minimizeWindow = (id) =>
    updateWindow(id, (curr) => ({ ...curr, minimized: !curr.minimized, closed: false, maximized: false }));
  const maximizeWindow = (id) =>
    updateWindow(id, (curr) => ({ ...curr, maximized: !curr.maximized, closed: false, minimized: false }));
  const restoreWindow = (id) => updateWindow(id, (curr) => ({ ...curr, closed: false }));

  const commandState = windowStates.command || defaultWindowState();
  const kpiState = windowStates.kpi || defaultWindowState();

  return (
    <main className="app">
      <div className="hero">
        <p className="eyebrow">startup grade telemetry workspace</p>
        <h1>Mission Control Dashboard</h1>
      </div>

      <div className="workspace">
        {!commandState.closed && (
          <WindowFrame
            title="Command Center"
            accent="cyan"
            className="overview-window"
            state={commandState}
            onClose={() => closeWindow('command')}
            onMinimize={() => minimizeWindow('command')}
            onMaximize={() => maximizeWindow('command')}
          >
            <div className="status-grid">
              <article className="status-tile">
                <p>Backend REST</p>
                <strong>{status.backendConnected ? 'ONLINE' : 'OFFLINE'}</strong>
              </article>
              <article className="status-tile">
                <p>WebSocket</p>
                <strong>{status.websocketConnected ? 'ONLINE' : 'OFFLINE'}</strong>
              </article>
              <article className="status-tile">
                <p>Sensores</p>
                <strong>{deviceIds.length}</strong>
              </article>
              <article className="status-tile">
                <p>Puntos</p>
                <strong>{totalPoints}</strong>
              </article>
            </div>
            {status.error && <p className="error">{status.error}</p>}
          </WindowFrame>
        )}

        {!kpiState.closed && (
          <WindowFrame
            title="Live KPIs"
            accent="blue"
            className="kpi-window"
            state={kpiState}
            onClose={() => closeWindow('kpi')}
            onMinimize={() => minimizeWindow('kpi')}
            onMaximize={() => maximizeWindow('kpi')}
          >
            <div className="kpi-grid">
              <article className="kpi-card">
                <p>Promedio temperatura</p>
                <h4>{avgTemperature} °C</h4>
              </article>
              <article className="kpi-card">
                <p>Promedio humedad</p>
                <h4>{avgHumidity} %</h4>
              </article>
              <article className="kpi-card">
                <p>Última actualización</p>
                <h4>{formatRelativeTime(status.lastReading?.timestamp, nowMs)}</h4>
              </article>
            </div>
          </WindowFrame>
        )}

        {deviceIds.length === 0 && (
          <WindowFrame title="Sensor Feed" className="feed-window" accent="cyan" state={defaultWindowState()}>
            <p className="empty">No hay lecturas disponibles todavía.</p>
          </WindowFrame>
        )}

        {deviceIds.map((deviceId) => {
          const chartData = formatChartData(readingsByDevice[deviceId]);
          const windowId = `sensor-${deviceId}`;
          const windowState = windowStates[windowId] || defaultWindowState();

          if (windowState.closed) {
            return null;
          }

          return (
            <WindowFrame
              key={windowId}
              title={`Sensor ${deviceId}`}
              className="feed-window"
              accent="cyan"
              state={windowState}
              onClose={() => closeWindow(windowId)}
              onMinimize={() => minimizeWindow(windowId)}
              onMaximize={() => maximizeWindow(windowId)}
            >
              <div className="chart-block">
                <h4>Temperatura vs tiempo</h4>
                <ResponsiveContainer width="100%" height={260}>
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
              </div>

              <div className="chart-block">
                <h4>Humedad vs tiempo</h4>
                <ResponsiveContainer width="100%" height={260}>
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
              </div>
            </WindowFrame>
          );
        })}
      </div>

      {closedWindows.length > 0 && (
        <div className="dock">
          <p>Dock</p>
          <div className="dock-list">
            {closedWindows.map((item) => (
              <button key={item.id} type="button" className="dock-item" onClick={() => restoreWindow(item.id)}>
                {item.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Dashboard />
  </React.StrictMode>
);
