package com.practica3.backend.service;

import com.practica3.backend.domain.SensorReading;
import com.practica3.backend.repository.SensorReadingRepository;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class SensorReadingService {

    private final SensorReadingRepository repository;

    public SensorReadingService(SensorReadingRepository repository) {
        this.repository = repository;
    }

    public SensorReading save(SensorReading reading) {
        return repository.save(reading);
    }

    public List<SensorReading> getRecentReadings() {
        return repository.findTop50ByOrderByReceivedAtDesc();
    }

    public List<SensorReading> getByDevice(Integer deviceId) {
        return repository.findTop50ByDeviceIdOrderByReceivedAtDesc(deviceId);
    }
}
