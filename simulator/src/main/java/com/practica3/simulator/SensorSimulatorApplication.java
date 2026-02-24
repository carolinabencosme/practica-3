package com.practica3.simulator;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.jms.Connection;
import jakarta.jms.JMSException;
import jakarta.jms.MessageProducer;
import jakarta.jms.Session;
import jakarta.jms.TextMessage;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Random;
import org.apache.activemq.ActiveMQConnectionFactory;
import org.apache.activemq.command.ActiveMQQueue;

public final class SensorSimulatorApplication {

    private static final DateTimeFormatter DATE_FORMATTER = DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm:ss");
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    private SensorSimulatorApplication() {
    }

    public static void main(String[] args) throws Exception {
        AppConfig config = AppConfig.load();
        Random random = new Random();

        System.out.printf(
                Locale.ROOT,
                "event=simulator_start deviceId=%s brokerUrl=%s destination=%s intervalSeconds=%d%n",
                config.deviceId(),
                config.brokerUrl(),
                config.destination(),
                config.intervalSeconds()
        );

        ActiveMQConnectionFactory connectionFactory = new ActiveMQConnectionFactory(config.failoverUrl());
        connectionFactory.setUserName(config.brokerUser());
        connectionFactory.setPassword(config.brokerPassword());

        while (true) {
            try (
                    Connection connection = connectionFactory.createConnection();
                    Session session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE)
            ) {
                connection.start();
                MessageProducer producer = session.createProducer(new ActiveMQQueue(config.destination()));
                publishLoop(config, random, session, producer);
            } catch (JMSException ex) {
                System.err.printf(Locale.ROOT, "event=simulator_connection_error message=%s%n", ex.getMessage());
                Thread.sleep(2_000L);
            }
        }
    }

    private static void publishLoop(
            AppConfig config,
            Random random,
            Session session,
            MessageProducer producer
    ) throws Exception {
        while (true) {
            String payload = buildPayload(config.deviceId(), random);
            TextMessage message = session.createTextMessage(payload);
            producer.send(message);

            System.out.printf(Locale.ROOT, "event=simulator_publish deviceId=%s payload=%s%n", config.deviceId(), payload);
            Thread.sleep(config.intervalSeconds() * 1_000L);
        }
    }

    private static String buildPayload(Integer deviceId, Random random) throws Exception {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("fechaGeneración", LocalDateTime.now().format(DATE_FORMATTER));
        payload.put("IdDispositivo", deviceId);
        payload.put("temperatura", roundBetween(random, 18.0, 34.0));
        payload.put("humedad", roundBetween(random, 30.0, 80.0));
        return OBJECT_MAPPER.writeValueAsString(payload);
    }

    private static double roundBetween(Random random, double min, double max) {
        double value = min + (max - min) * random.nextDouble();
        return Math.round(value * 100.0) / 100.0;
    }

    private record AppConfig(
            Integer deviceId,
            String brokerUrl,
            String brokerUser,
            String brokerPassword,
            String destination,
            int intervalSeconds
    ) {
        static AppConfig load() {
            Integer deviceId = Integer.parseInt(env("DEVICE_ID", "1"));
            String brokerUrl = env("BROKER_URL", "tcp://activemq:61616");
            String brokerUser = env("BROKER_USER", "admin");
            String brokerPassword = env("BROKER_PASSWORD", "admin");
            String destination = env("DESTINATION", "notificacion_sensores");
            int intervalSeconds = Integer.parseInt(env("PUBLISH_INTERVAL_SECONDS", "5"));

            if (intervalSeconds <= 0) {
                throw new IllegalArgumentException("PUBLISH_INTERVAL_SECONDS must be > 0");
            }

            return new AppConfig(deviceId, brokerUrl, brokerUser, brokerPassword, destination, intervalSeconds);
        }

        String failoverUrl() {
            if (brokerUrl.startsWith("failover:(")) {
                return brokerUrl;
            }
            return "failover:(" + brokerUrl + ")?maxReconnectAttempts=-1&initialReconnectDelay=1000&useExponentialBackOff=true";
        }

        private static String env(String key, String defaultValue) {
            String value = System.getenv(key);
            if (value == null || value.isBlank()) {
                return defaultValue;
            }
            return value;
        }
    }
}
