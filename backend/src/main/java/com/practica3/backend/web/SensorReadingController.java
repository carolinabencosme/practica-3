package com.practica3.backend.web;

import com.practica3.backend.dto.SensorReadingResponse;
import com.practica3.backend.service.SensorReadingService;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/readings")
public class SensorReadingController {

    private final SensorReadingService sensorReadingService;

    public SensorReadingController(SensorReadingService sensorReadingService) {
        this.sensorReadingService = sensorReadingService;
    }

    @GetMapping("/recent")
    public List<SensorReadingResponse> getRecentReadings() {
        return sensorReadingService.getRecentReadings()
                .stream()
                .map(SensorReadingResponse::fromEntity)
                .toList();
    }

    @GetMapping("/by-device/{deviceId}")
    public List<SensorReadingResponse> getByDevice(@PathVariable String deviceId) {
        return sensorReadingService.getByDevice(deviceId)
                .stream()
                .map(SensorReadingResponse::fromEntity)
                .toList();
    }
}
