FROM maven:3.9.9-eclipse-temurin-21-alpine AS builder

WORKDIR /build
COPY pom.xml ./
COPY src ./src
RUN mvn -B -DskipTests package

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=builder /build/target/simulator.jar /app/simulator.jar
CMD ["java", "-jar", "/app/simulator.jar"]
