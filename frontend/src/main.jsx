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
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 2;
const DESKTOP_WIDTH = 3200;
const DESKTOP_HEIGHT = 2400;
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
  if (!message?.body) return null;
  try {
    const payload = JSON.parse(message.body);
    if (Array.isArray(payload)) return payload.map(normalizeReading);
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
  return { mode: 'normal', expanded: false };
}

function WindowFrame({
  title,
  accent = 'cyan',
  children,
  className = '',
  state,
  onClose,
  onMinimize,
  onExpand,
  onDragStart,
  onDragOver,
  onDrop
}) {
  const windowClass = [
    'window',
    accent,
    className,
    state.expanded ? 'expanded' : ''
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className={windowClass} onDragOver={onDragOver} onDrop={onDrop}>
      <header className="window-head" draggable onDragStart={onDragStart}>
        <div className="window-mac-controls" role="group" aria-label={`Controles de ${title}`}>
          <button type="button" className="mac-btn close" onClick={onClose} title="Cerrar ventana">
            <span>×</span>
          </button>
          <button type="button" className="mac-btn min" onClick={onMinimize} title="Minimizar ventana">
            <span>−</span>
          </button>
          <button type="button" className="mac-btn zoom" onClick={onExpand} title="Expandir ventana">
            <span>□</span>
          </button>
        </div>
        <h3>{title}</h3>
      </header>
      <div className="window-body">{children}</div>
    </section>
  );
}

function Dashboard() {
  const [readingsByDevice, setReadingsByDevice] = React.useState({});
  const [nowMs, setNowMs] = React.useState(Date.now());
  const [zoom, setZoom] = React.useState(1);
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = React.useState(false);
  const panStartRef = React.useRef(null);
  const spacePressedRef = React.useRef(false);
  const [draggingId, setDraggingId] = React.useState(null);
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
    const onKeyDown = (e) => {
      if (e.code === 'Space') {
        spacePressedRef.current = true;
        e.preventDefault();
      }
    };
    const onKeyUp = (e) => {
      if (e.code === 'Space') {
        spacePressedRef.current = false;
        setIsPanning(false);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const [windowOrder, setWindowOrder] = React.useState(['command', 'kpi']);

  React.useEffect(() => {
    let active = true;

    const loadInitialReadings = async () => {
      try {
        const response = await fetch(`${restBase}/api/readings/recent`);
        if (!response.ok) throw new Error(`Error HTTP ${response.status}`);
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
    const sensorKeys = deviceIds.map((id) => `sensor-${id}`);
    setWindowStates((prev) => {
      const next = { ...prev };
      sensorKeys.forEach((key) => {
        if (!next[key]) next[key] = defaultWindowState();
      });
      return next;
    });

    setWindowOrder((prev) => {
      const merged = [...prev];
      sensorKeys.forEach((key) => {
        if (!merged.includes(key)) merged.push(key);
      });
      return merged.filter((id) => ['command', 'kpi', ...sensorKeys].includes(id));
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
    deviceIds.forEach((id) => {
      base[`sensor-${id}`] = `Sensor ${id}`;
    });
    return base;
  }, [deviceIds]);

  const updateWindow = React.useCallback((id, updater) => {
    setWindowStates((prev) => {
      const current = prev[id] || defaultWindowState();
      return { ...prev, [id]: updater(current) };
    });
  }, []);

  const closeWindow = (id) => updateWindow(id, (curr) => ({ ...curr, mode: 'closed', expanded: false }));
  const minimizeWindow = (id) => updateWindow(id, (curr) => ({ ...curr, mode: 'minimized', expanded: false }));
  const expandWindow = (id) =>
    updateWindow(id, (curr) => ({ ...curr, mode: 'normal', expanded: !curr.expanded }));
  const restoreWindow = (id) => updateWindow(id, (curr) => ({ ...curr, mode: 'normal' }));

  const zoomOut = () => setZoom((z) => Math.max(MIN_ZOOM, Number((z - 0.1).toFixed(2))));
  const zoomIn = () => setZoom((z) => Math.min(MAX_ZOOM, Number((z + 0.1).toFixed(2))));
  const resetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleViewportMouseDown = (e) => {
    if (e.button === 2 || (e.button === 0 && spacePressedRef.current)) {
      e.preventDefault();
      setIsPanning(true);
      panStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        panX: pan.x,
        panY: pan.y
      };
    }
  };
  const handleViewportMouseMove = (e) => {
    if (!isPanning || !panStartRef.current) return;
    setPan({
      x: panStartRef.current.panX + e.clientX - panStartRef.current.clientX,
      y: panStartRef.current.panY + e.clientY - panStartRef.current.clientY
    });
  };
  const handleViewportMouseUp = () => {
    setIsPanning(false);
    panStartRef.current = null;
  };
  const handleViewportWheel = (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    setZoom((z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number((z + delta).toFixed(3)))));
  };

  const dockItems = Object.entries(windowStates)
    .filter(([, state]) => state.mode !== 'normal')
    .map(([id, state]) => ({ id, state, title: windowMeta[id] || id }));

  const moveWindow = (fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return;
    setWindowOrder((prev) => {
      const next = [...prev];
      const fromIndex = next.indexOf(fromId);
      const toIndex = next.indexOf(toId);
      if (fromIndex < 0 || toIndex < 0) return prev;
      next.splice(fromIndex, 1);
      next.splice(toIndex, 0, fromId);
      return next;
    });
  };

  const renderWindowContent = (id) => {
    if (id === 'command') {
      return (
        <>
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
        </>
      );
    }

    if (id === 'kpi') {
      return (
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
      );
    }

    const sensorId = id.replace('sensor-', '');
    const chartData = formatChartData(readingsByDevice[sensorId] || []);

    return (
      <>
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
      </>
    );
  };

  const getWindowAccent = (id) => (id === 'kpi' ? 'blue' : 'cyan');
  const getWindowClass = (id) => {
    if (id === 'command') return 'overview-window';
    if (id === 'kpi') return 'kpi-window';
    return 'feed-window';
  };

  return (
    <main className="app">
      <div className="hero">
        <p className="eyebrow">startup grade telemetry workspace</p>
        <h1>Mission Control Dashboard</h1>
      </div>

      <div className="workspace-toolbar">
        <div className="toolbar-badge" title="Mantén Espacio + arrastrar o clic derecho para mover. Ctrl + rueda para zoom.">Escritorio</div>
        <div className="zoom-controls">
          <button type="button" onClick={zoomOut}>−</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={zoomIn}>+</button>
          <button type="button" onClick={resetZoom}>Reset</button>
        </div>
      </div>

      <div
        className="workspace-viewport"
        role="application"
        aria-label="Escritorio: arrastra con botón derecho o Mantén Espacio + arrastrar para mover. Ctrl + rueda para zoom."
        onMouseDown={handleViewportMouseDown}
        onMouseMove={handleViewportMouseMove}
        onMouseUp={handleViewportMouseUp}
        onMouseLeave={handleViewportMouseUp}
        onContextMenu={(e) => e.preventDefault()}
        onWheel={handleViewportWheel}
        style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
      >
        <div
          className="workspace-desktop"
          style={{
            width: DESKTOP_WIDTH,
            height: DESKTOP_HEIGHT,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0'
          }}
        >
          <div className="workspace">
          {windowOrder
            .filter((id) => (windowStates[id] || defaultWindowState()).mode === 'normal')
            .map((id) => {
              const state = windowStates[id] || defaultWindowState();
              const title = windowMeta[id] || id;

              return (
                <WindowFrame
                  key={id}
                  title={title}
                  accent={getWindowAccent(id)}
                  className={getWindowClass(id)}
                  state={state}
                  onClose={() => closeWindow(id)}
                  onMinimize={() => minimizeWindow(id)}
                  onExpand={() => expandWindow(id)}
                  onDragStart={() => setDraggingId(id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    moveWindow(draggingId, id);
                    setDraggingId(null);
                  }}
                >
                  {renderWindowContent(id)}
                </WindowFrame>
              );
            })}

          {deviceIds.length === 0 && (
            <WindowFrame
              title="Sensor Feed"
              className="feed-window"
              accent="cyan"
              state={defaultWindowState()}
            >
              <p className="empty">No hay lecturas disponibles todavía.</p>
            </WindowFrame>
          )}
          </div>
        </div>
      </div>

      {dockItems.length > 0 && (
        <div className="dock">
          <p>Apps (clic para restaurar)</p>
          <div className="dock-list">
            {dockItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`dock-item ${item.state.mode}`}
                onClick={() => restoreWindow(item.id)}
              >
                <span className="dock-dot" />
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
