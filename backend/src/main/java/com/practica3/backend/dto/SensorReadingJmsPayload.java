package com.practica3.backend.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public class SensorReadingJmsPayload {

    @NotBlank
    @JsonProperty("fechaGeneración")
    private String fechaGeneracion;

    @NotNull
    @JsonProperty("IdDispositivo")
    private Integer idDispositivo;

    @NotNull
    @Min(-80)
    @Max(120)
    @JsonProperty("temperatura")
    private Double temperatura;

    @NotNull
    @Min(0)
    @Max(100)
    @JsonProperty("humedad")
    private Double humedad;

    public String getFechaGeneracion() {
        return fechaGeneracion;
    }

    public void setFechaGeneracion(String fechaGeneracion) {
        this.fechaGeneracion = fechaGeneracion;
    }

    public Integer getIdDispositivo() {
        return idDispositivo;
    }

    public void setIdDispositivo(Integer idDispositivo) {
        this.idDispositivo = idDispositivo;
    }

    public Double getTemperatura() {
        return temperatura;
    }

    public void setTemperatura(Double temperatura) {
        this.temperatura = temperatura;
    }

    public Double getHumedad() {
        return humedad;
    }

    public void setHumedad(Double humedad) {
        this.humedad = humedad;
    }
}
