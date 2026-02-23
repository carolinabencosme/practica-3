FROM gradle:8.10.2-jdk21-alpine AS builder
WORKDIR /build
COPY build.gradle settings.gradle ./
COPY src ./src
RUN gradle --no-daemon shadowJar -x test

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=builder /build/build/libs/simulator.jar /app/simulator.jar
CMD ["java", "-jar", "/app/simulator.jar"]
