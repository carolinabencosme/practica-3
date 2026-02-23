package com.practica3.backend.repository;

import com.practica3.backend.domain.SensorReading;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SensorReadingRepository extends JpaRepository<SensorReading, Long> {

    List<SensorReading> findTop50ByOrderByReceivedAtDesc();

    List<SensorReading> findTop50ByDeviceIdOrderByReceivedAtDesc(Integer deviceId);
}
