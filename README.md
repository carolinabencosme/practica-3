# practica-3

Estructura base para una plataforma de telemetría en tiempo real con **Spring Boot + JMS + WebSocket + PostgreSQL**.

## Arquitectura

El proyecto está organizado por componentes:

- `backend/`: API Spring Boot, consumidor JMS, persistencia en PostgreSQL y difusión por WebSocket.
- `simulator/`: publicador de eventos/sensores hacia ActiveMQ (reutilizado por `simulator-1` y `simulator-2`).
- `frontend/`: dashboard en tiempo real conectado al backend.
- `docker/`: scripts/configuraciones opcionales de infraestructura.

Servicios orquestados en `docker-compose.yml`:

1. `activemq`: broker JMS/OpenWire.
2. `postgres`: base de datos relacional.
3. `backend`: servicio API + WebSocket + consumidor JMS.
4. `simulator-1`: simulador de sensores #1.
5. `simulator-2`: simulador de sensores #2.
6. `frontend`: dashboard web.

## Prerrequisitos

- Docker
- Docker Compose plugin (`docker compose`)

## Configuración

1. Copia variables de entorno de ejemplo:

   ```bash
   cp .env.example .env
   ```

2. Ajusta puertos/credenciales según necesidad.

## Arranque (comando único)

```bash
docker compose up --build
```

Esto levantará toda la plataforma con los seis servicios definidos.

## Simulator

`simulator/` contiene una app Java que publica telemetría JMS/OpenWire al destino `notificacion_sensores`.

Variables de entorno soportadas:

- `DEVICE_ID`
- `BROKER_URL`
- `BROKER_USER`
- `BROKER_PASSWORD`
- `DESTINATION` (default: `notificacion_sensores`)
- `PUBLISH_INTERVAL_SECONDS`

Cada publicación incluye JSON con los campos `fechaGeneración` (`DD/MM/YYYY HH:mm:ss`), `IdDispositivo`, `temperatura` y `humedad`.
