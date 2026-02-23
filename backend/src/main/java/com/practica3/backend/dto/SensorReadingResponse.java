package com.practica3.backend.dto;

import com.practica3.backend.domain.SensorReading;
import java.time.Instant;

public record SensorReadingResponse(
        Long id,
        Instant generatedAt,
        String deviceId,
        Double temperature,
        Double humidity,
        Instant receivedAt
) {
    public static SensorReadingResponse fromEntity(SensorReading reading) {
        return new SensorReadingResponse(
                reading.getId(),
                reading.getGeneratedAt(),
                reading.getDeviceId(),
                reading.getTemperature(),
                reading.getHumidity(),
                reading.getReceivedAt()
        );
    }
}
