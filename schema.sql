-- ============================================================
-- Database Schema: simulator_vps
-- Jalankan script ini sekali di MySQL server VPS (Hostinger)
-- via phpMyAdmin atau: mysql -u root -p simulator_vps < schema.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS simulator_vps
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE simulator_vps;

-- ============================================================
-- Tabel 1: Data Suhu dari BPCS (bpcs.ino)
-- Payload MQTT: { temperature, voltage, valve_percent, send_timestamp }
-- ============================================================
CREATE TABLE IF NOT EXISTS sensor_temperature (
    id               INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    temperature      FLOAT           NULL COMMENT 'Suhu aktual dalam °C',
    voltage_temp     FLOAT           NULL COMMENT 'Tegangan sensor suhu (V)',
    valve_percent    FLOAT           NULL COMMENT 'Posisi valve stepper (%)',
    send_timestamp   DATETIME        NULL COMMENT 'Timestamp dari RTC ESP32',
    receive_timestamp DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Timestamp diterima server',
    PRIMARY KEY (id),
    INDEX idx_receive_ts (receive_timestamp)
) ENGINE=InnoDB;

-- ============================================================
-- Tabel 2: Data Tekanan dari SIS (sis.ino)
-- Payload MQTT: { pressure, voltage, sv1_status, sv2_status,
--                 buzzer_status, shutdown_active, send_timestamp }
-- ============================================================
CREATE TABLE IF NOT EXISTS sensor_pressure (
    id                INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    pressure          FLOAT           NULL COMMENT 'Tekanan aktual dalam Bar',
    voltage_pressure  FLOAT           NULL COMMENT 'Tegangan sensor tekanan (V)',
    sv1_status        TINYINT(1)      NULL COMMENT '1=OPEN, 0=CLOSE (Normal Valve)',
    sv2_status        TINYINT(1)      NULL COMMENT '1=OPEN, 0=CLOSE (Safety Valve)',
    buzzer_status     TINYINT(1)      NULL COMMENT '1=ON, 0=OFF',
    shutdown_active   TINYINT(1)      NULL DEFAULT 0 COMMENT '1=Shutdown aktif',
    send_timestamp    DATETIME        NULL COMMENT 'Timestamp dari RTC ESP32',
    receive_timestamp DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Timestamp diterima server',
    PRIMARY KEY (id),
    INDEX idx_receive_ts (receive_timestamp)
) ENGINE=InnoDB;
