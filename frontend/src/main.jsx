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
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 2;
const DESKTOP_WIDTH = 3200;
const DESKTOP_HEIGHT = 2400;
const GRID_SIZE = 24;
const WINDOW_MIN_W = 380;
const WINDOW_MIN_H = 220;
const PAN_SAFE_MARGIN = 180;

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

function snapToGrid(value) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

function clampWindow(layout) {
  return {
    ...layout,
    x: Math.min(Math.max(0, snapToGrid(layout.x)), DESKTOP_WIDTH - layout.w),
    y: Math.min(Math.max(0, snapToGrid(layout.y)), DESKTOP_HEIGHT - layout.h),
    w: Math.max(WINDOW_MIN_W, snapToGrid(layout.w)),
    h: Math.max(WINDOW_MIN_H, snapToGrid(layout.h))
  };
}

function createDefaultLayout(id, index = 0) {
  if (id === 'command') return { x: 72, y: 72, w: 1380, h: 290 };
  if (id === 'kpi') return { x: 1470, y: 72, w: 900, h: 290 };
  return { x: 72, y: 390 + index * 630, w: 2290, h: 600 };
}

function clampPan(nextPan, viewport, zoom) {
  if (!viewport) return nextPan;

  const scaledWidth = DESKTOP_WIDTH * zoom;
  const scaledHeight = DESKTOP_HEIGHT * zoom;

  const minX = viewport.width - scaledWidth - PAN_SAFE_MARGIN;
  const maxX = PAN_SAFE_MARGIN;
  const minY = viewport.height - scaledHeight - PAN_SAFE_MARGIN;
  const maxY = PAN_SAFE_MARGIN;

  return {
    x: Math.min(maxX, Math.max(minX, nextPan.x)),
    y: Math.min(maxY, Math.max(minY, nextPan.y))
  };
}

function shouldBlockPanTarget(target) {
  if (!(target instanceof Element)) return false;

  return Boolean(
    target.closest(
      [
        'button',
        'a',
        'input',
        'textarea',
        'select',
        '[contenteditable="true"]',
        '[data-no-pan="true"]',
        '.recharts-wrapper',
        '.recharts-responsive-container',
        '.window',
        '.dock'
      ].join(',')
    )
  );
}

function WindowFrame({
  title,
  accent = 'cyan',
  children,
  className = '',
  style,
  state,
  onClose,
  onMinimize,
  onExpand,
  onHeaderMouseDown
}) {
  const windowClass = ['window', accent, className, state.expanded ? 'expanded' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <section className={windowClass} style={style}>
      <header className="window-head" onMouseDown={onHeaderMouseDown}>
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
  const [windowOrder, setWindowOrder] = React.useState(['command', 'kpi']);
  const [windowLayouts, setWindowLayouts] = React.useState({
    command: createDefaultLayout('command'),
    kpi: createDefaultLayout('kpi')
  });
  const [dragging, setDragging] = React.useState(null);

  const panStartRef = React.useRef(null);
  const viewportRef = React.useRef(null);
  const appRef = React.useRef(null);
  const spacePressedRef = React.useRef(false);
  const activePanPointerRef = React.useRef(null);

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
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    setPan((prev) => clampPan(prev, rect, zoom));
  }, [zoom]);

  React.useEffect(() => {
    const onResize = () => {
      const rect = viewportRef.current?.getBoundingClientRect();
      setPan((prev) => clampPan(prev, rect, zoom));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [zoom]);

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

    setWindowLayouts((prev) => {
      const next = { ...prev };
      sensorKeys.forEach((key, index) => {
        if (!next[key]) next[key] = createDefaultLayout(key, index);
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

  React.useEffect(() => {
    if (!dragging) return undefined;

    const onMouseMove = (event) => {
      const viewportRect = viewportRef.current?.getBoundingClientRect();
      if (!viewportRect) return;

      const desktopX = (event.clientX - viewportRect.left - pan.x) / zoom;
      const desktopY = (event.clientY - viewportRect.top - pan.y) / zoom;

      const currentLayout = windowLayouts[dragging.id];
      if (!currentLayout) return;

      const next = clampWindow({
        ...currentLayout,
        x: desktopX - dragging.offsetX,
        y: desktopY - dragging.offsetY
      });

      setWindowLayouts((prev) => ({ ...prev, [dragging.id]: next }));
    };

    const onMouseUp = () => setDragging(null);

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [dragging, pan, zoom, windowLayouts]);

  React.useEffect(() => {
    const panSurface = appRef.current;
    if (!panSurface) return undefined;

    const getPanBounds = () => {
      const appRect = panSurface.getBoundingClientRect();
      if (appRect) return appRect;
      return {
        width: window.innerWidth,
        height: window.innerHeight
      };
    };

    const onPointerDown = (event) => {
      if (activePanPointerRef.current != null || dragging) return;
      if (event.pointerType === 'mouse' && !(event.button === 0 || event.button === 1 || event.button === 2)) return;
      if (shouldBlockPanTarget(event.target)) return;

      const shouldStartPan =
        event.button === 1 || event.button === 2 || spacePressedRef.current || event.button === 0;

      if (!shouldStartPan) return;

      event.preventDefault();
      setIsPanning(true);
      activePanPointerRef.current = event.pointerId;

      if (panSurface.setPointerCapture) {
        panSurface.setPointerCapture(event.pointerId);
      }

      panStartRef.current = {
        clientX: event.clientX,
        clientY: event.clientY,
        panX: pan.x,
        panY: pan.y
      };
    };

    const onPointerMove = (event) => {
      if (!panStartRef.current || activePanPointerRef.current !== event.pointerId) return;

      const nextPan = {
        x: panStartRef.current.panX + event.clientX - panStartRef.current.clientX,
        y: panStartRef.current.panY + event.clientY - panStartRef.current.clientY
      };

      setPan(clampPan(nextPan, getPanBounds(), zoom));
    };

    const stopPan = (event) => {
      if (activePanPointerRef.current !== event.pointerId) return;
      if (panSurface.releasePointerCapture) {
        try {
          panSurface.releasePointerCapture(event.pointerId);
        } catch (_) {
          // no-op
        }
      }

      activePanPointerRef.current = null;
      panStartRef.current = null;
      setIsPanning(false);
    };

    panSurface.addEventListener('pointerdown', onPointerDown, { passive: false });
    panSurface.addEventListener('pointermove', onPointerMove, { passive: true });
    panSurface.addEventListener('pointerup', stopPan, { passive: true });
    panSurface.addEventListener('pointercancel', stopPan, { passive: true });

    return () => {
      panSurface.removeEventListener('pointerdown', onPointerDown);
      panSurface.removeEventListener('pointermove', onPointerMove);
      panSurface.removeEventListener('pointerup', stopPan);
      panSurface.removeEventListener('pointercancel', stopPan);
    };
  }, [dragging, pan.x, pan.y, zoom]);

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

  const focusWindow = (id) => {
    setWindowOrder((prev) => [...prev.filter((item) => item !== id), id]);
  };

  const startWindowDrag = (event, id) => {
    if (event.button !== 0 || spacePressedRef.current) return;

    event.preventDefault();
    focusWindow(id);

    const viewportRect = viewportRef.current?.getBoundingClientRect();
    const layout = windowLayouts[id];
    if (!viewportRect || !layout) return;

    const desktopX = (event.clientX - viewportRect.left - pan.x) / zoom;
    const desktopY = (event.clientY - viewportRect.top - pan.y) / zoom;

    setDragging({
      id,
      offsetX: desktopX - layout.x,
      offsetY: desktopY - layout.y
    });
  };

  const zoomOut = () => setZoom((z) => Math.max(MIN_ZOOM, Number((z - 0.1).toFixed(2))));
  const zoomIn = () => setZoom((z) => Math.min(MAX_ZOOM, Number((z + 0.1).toFixed(2))));
  const resetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleViewportWheel = (e) => {
    const viewport = appRef.current?.getBoundingClientRect();

    if (!e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const speed = 1;
      setPan((prev) => {
        const nextPan = {
          x: prev.x - e.deltaX * speed,
          y: prev.y - e.deltaY * speed
        };
        return clampPan(nextPan, viewport, zoom);
      });
      return;
    }

    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    setZoom((z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number((z + delta).toFixed(3)))));
  };

  const desktopAppIcons = Object.entries(windowStates)
    .filter(([, state]) => state.mode === 'closed')
    .map(([id, state]) => ({ id, state, title: windowMeta[id] || id }));

  const dockItems = Object.entries(windowStates)
    .filter(([, state]) => state.mode === 'minimized')
    .map(([id, state]) => ({ id, state, title: windowMeta[id] || id }));

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

  const windowStyle = (id) => {
    const state = windowStates[id] || defaultWindowState();
    const baseLayout = clampWindow(windowLayouts[id] || createDefaultLayout(id));

    if (state.expanded) {
      return {
        left: GRID_SIZE,
        top: GRID_SIZE,
        width: DESKTOP_WIDTH - GRID_SIZE * 2,
        height: DESKTOP_HEIGHT - GRID_SIZE * 2,
        zIndex: 999
      };
    }

    return {
      left: baseLayout.x,
      top: baseLayout.y,
      width: baseLayout.w,
      height: baseLayout.h,
      zIndex: Math.max(1, windowOrder.indexOf(id) + 1)
    };
  };

  return (
    <main className={`app ${isPanning ? 'is-panning' : ''}`} ref={appRef}>
      <div className="page-grid-bg" aria-hidden="true" />

      <div className="hero">
        <p className="eyebrow">startup grade telemetry workspace</p>
        <h1>Mission Control Dashboard</h1>
      </div>

      <div className="workspace-toolbar">
        <div className="toolbar-badge" title="Mantén Espacio + arrastrar o clic derecho para mover. Arrastra la barra del dashboard para moverlo por grid.">
          Grid Fullscreen · estilo Startup YC
        </div>
        <div className="zoom-controls" data-no-pan="true">
          <button type="button" onClick={zoomOut}>−</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={zoomIn}>+</button>
          <button type="button" onClick={resetZoom}>Reset</button>
        </div>
      </div>

      <div
        className="workspace-viewport"
        ref={viewportRef}
        role="application"
        aria-label="Escritorio: arrastra con clic central/derecho o Espacio + arrastrar para mover. Rueda para navegar y Ctrl + rueda para zoom."
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
          <div className="desktop-apps" aria-label="Apps cerradas en escritorio" data-no-pan="true">
            {desktopAppIcons.map((item) => (
              <button key={item.id} type="button" className="desktop-app-icon" onClick={() => restoreWindow(item.id)}>
                <span className="desktop-app-glyph">◻</span>
                <span className="desktop-app-label">{item.title}</span>
              </button>
            ))}
          </div>

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
                  className={dragging?.id === id ? 'dragging' : ''}
                  style={windowStyle(id)}
                  state={state}
                  onClose={() => closeWindow(id)}
                  onMinimize={() => minimizeWindow(id)}
                  onExpand={() => expandWindow(id)}
                  onHeaderMouseDown={(event) => startWindowDrag(event, id)}
                >
                  {renderWindowContent(id)}
                </WindowFrame>
              );
            })}

          {deviceIds.length === 0 && (
            <section className="window cyan empty-feed" style={{ left: 72, top: 390, width: 2290, zIndex: 2 }}>
              <header className="window-head">
                <h3>Sensor Feed</h3>
              </header>
              <div className="window-body">
                <p className="empty">No hay lecturas disponibles todavía.</p>
              </div>
            </section>
          )}
        </div>
      </div>

      {dockItems.length > 0 && (
        <div className="dock" data-no-pan="true">
          <p>Apps minimizadas (clic para restaurar)</p>
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
