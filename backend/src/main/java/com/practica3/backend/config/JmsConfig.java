package com.practica3.backend.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jms.annotation.EnableJms;
import org.springframework.jms.support.converter.MessageConverter;
import org.springframework.jms.support.converter.SimpleMessageConverter;

@Configuration
@EnableJms
public class JmsConfig {

    @Bean
    public MessageConverter messageConverter() {
        return new SimpleMessageConverter();
    }
}
