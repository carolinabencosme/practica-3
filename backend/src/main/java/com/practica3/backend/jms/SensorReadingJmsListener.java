package com.practica3.backend.jms;

import com.practica3.backend.domain.SensorReading;
import com.practica3.backend.dto.SensorReadingJmsPayload;
import com.practica3.backend.dto.SensorReadingResponse;
import com.practica3.backend.service.SensorReadingService;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.Validator;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.Set;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jms.annotation.JmsListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

@Component
public class SensorReadingJmsListener {

    private static final Logger log = LoggerFactory.getLogger(SensorReadingJmsListener.class);

    private final Validator validator;
    private final SensorReadingService sensorReadingService;
    private final SimpMessagingTemplate messagingTemplate;

    public SensorReadingJmsListener(
            Validator validator,
            SensorReadingService sensorReadingService,
            SimpMessagingTemplate messagingTemplate
    ) {
        this.validator = validator;
        this.sensorReadingService = sensorReadingService;
        this.messagingTemplate = messagingTemplate;
    }

    @JmsListener(destination = "notificacion_sensores")
    public void consume(SensorReadingJmsPayload payload) {
        try {
            validatePayload(payload);
            SensorReading saved = sensorReadingService.save(toEntity(payload));
            SensorReadingResponse response = SensorReadingResponse.fromEntity(saved);
            messagingTemplate.convertAndSend("/topic/readings", response);

            log.info(
                    "event=jms_reading_processed deviceId={} generatedAt={} receivedAt={} temperature={} humidity={}",
                    response.deviceId(),
                    response.generatedAt(),
                    response.receivedAt(),
                    response.temperature(),
                    response.humidity()
            );
        } catch (ConstraintViolationException | DateTimeParseException ex) {
            log.warn(
                    "event=jms_reading_rejected reason={} payloadDevice={} payloadDate={}",
                    ex.getMessage(),
                    payload != null ? payload.getIdDispositivo() : "null",
                    payload != null ? payload.getFechaGeneracion() : "null"
            );
        } catch (Exception ex) {
            log.error("event=jms_reading_failed message={}", ex.getMessage(), ex);
            throw ex;
        }
    }

    private void validatePayload(SensorReadingJmsPayload payload) {
        if (payload == null) {
            throw new ConstraintViolationException("Payload cannot be null", Set.of());
        }

        Set<ConstraintViolation<SensorReadingJmsPayload>> violations = validator.validate(payload);
        if (!violations.isEmpty()) {
            String message = violations.stream()
                    .map(v -> v.getPropertyPath() + " " + v.getMessage())
                    .collect(Collectors.joining(", "));
            throw new ConstraintViolationException(message, violations);
        }
    }

    private SensorReading toEntity(SensorReadingJmsPayload payload) {
        SensorReading reading = new SensorReading();
        reading.setGeneratedAt(Instant.parse(payload.getFechaGeneracion()));
        reading.setDeviceId(payload.getIdDispositivo());
        reading.setTemperature(payload.getTemperatura());
        reading.setHumidity(payload.getHumedad());
        reading.setReceivedAt(Instant.now());
        return reading;
    }
}
