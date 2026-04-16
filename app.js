const mqtt    = require('mqtt');    
const mysql   = require('mysql2');
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// ============================================================
// SERVE FRONTEND (static files)
// ============================================================
app.use(express.static(path.join(__dirname, 'frontend')));

// ============================================================
// 1. DATABASE CONNECTION  (Hostinger VPS MySQL)
// ============================================================
const db = mysql.createConnection({
    host:     'localhost',
    user:     'root',
    password: '',                // ganti sesuai password MySQL VPS kamu
    database: 'simulator_vps'
});

db.connect((err) => {
    if (err) {
        console.error('❌ Gagal koneksi database:', err.message);
    } else {
        console.log('✅ Database MySQL Terhubung!');
    }
});

// ============================================================
// 2. MQTT — Connect to HiveMQ Cloud  (SAMA seperti ESP32)
// ============================================================
// FIX #1: Ganti mqtt://localhost → HiveMQ Cloud URL
// FIX #2: Username/password disamakan dengan ESP32 firmware
const MQTT_BROKER   = 'mqtts://daeb68cee1a0470ab4fbd5a4f1691fe8.s1.eu.hivemq.cloud';
const MQTT_PORT     = 8883;
const MQTT_USER     = 'auliazqi';
const MQTT_PASS     = 'Serveradmin123';

// FIX #3: Topik yang benar — sama persis dengan publish di firmware
const TOPIC_TEMP     = 'plant/data/temperature';
const TOPIC_PRESSURE = 'sis/data/pressure';
const TOPIC_CONTROL  = 'admin/control/setpoints';  // backend publish ke ESP32

const mqttClient = mqtt.connect(MQTT_BROKER, {
    port:               MQTT_PORT,
    username:           MQTT_USER,
    password:           MQTT_PASS,
    rejectUnauthorized: false,          // setInsecure() equivalent
    reconnectPeriod:    5000,
    clientId:           'Backend_Server_' + Math.random().toString(16).slice(2, 8),
});

mqttClient.on('connect', () => {
    console.log('✅ Broker HiveMQ Terhubung!');

    // FIX #3: Subscribe ke topik yang benar
    mqttClient.subscribe([TOPIC_TEMP, TOPIC_PRESSURE], { qos: 1 }, (err) => {
        if (err) console.error('❌ Gagal subscribe:', err.message);
        else     console.log(`📡 Subscribed ke: ${TOPIC_TEMP} & ${TOPIC_PRESSURE}`);
    });
});

mqttClient.on('error', (err) => {
    console.error('❌ MQTT Error:', err.message);
});

mqttClient.on('reconnect', () => {
    console.log('🔄 MQTT Reconnecting...');
});

// ============================================================
// 3. TERIMA PESAN MQTT — Simpan ke Database
// ============================================================
// FIX #4: Pisahkan handling TEMPERATURE dan PRESSURE
// FIX #5: Gunakan nama field yang benar sesuai JSON firmware

mqttClient.on('message', (topic, message) => {
    let d;
    try {
        d = JSON.parse(message.toString());
    } catch (e) {
        console.warn('⚠️ Format JSON tidak valid dari topik:', topic);
        return;
    }

    // --- TEMPERATURE dari BPCS ---
    // Payload: { temperature, voltage, valve_percent, send_timestamp }
    if (topic === TOPIC_TEMP) {
        const query = `
            INSERT INTO sensor_temperature
                (temperature, voltage_temp, valve_percent, send_timestamp, receive_timestamp)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        `;
        const values = [
            d.temperature   ?? null,
            d.voltage       ?? null,
            d.valve_percent ?? null,
            d.send_timestamp ?? null,
        ];
        db.query(query, values, (err) => {
            if (err) console.error('❌ Error Simpan Suhu:', err.message);
            else     console.log('🌡️  Data Suhu Tersimpan:', d.temperature, '°C');
        });
    }

    // --- PRESSURE dari SIS ---
    // Payload: { pressure, voltage, sv1_status, sv2_status, buzzer_status, shutdown_active, send_timestamp }
    else if (topic === TOPIC_PRESSURE) {
        const query = `
            INSERT INTO sensor_pressure
                (pressure, voltage_pressure, sv1_status, sv2_status,
                 buzzer_status, shutdown_active, send_timestamp, receive_timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `;
        const values = [
            d.pressure         ?? null,
            d.voltage          ?? null,
            d.sv1_state        ?? null,   // firmware sends sv1_state
            d.sv2_state        ?? null,   // firmware sends sv2_state
            d.alarm_status     ?? null,   // firmware sends alarm_status ("ON"/"OFF")
            d.shutdown_active  ?? false,
            d.send_timestamp   ?? null,
        ];
        db.query(query, values, (err) => {
            if (err) console.error('❌ Error Simpan Tekanan:', err.message);
            else     console.log('💨 Data Tekanan Tersimpan:', d.pressure, 'Bar');
        });
    }
});

// ============================================================
// 4. API: GET /api/latest-data  (FIX #6: Endpoint yang dipanggil frontend)
//    Ambil data terbaru dari KEDUA tabel, gabungkan jadi 1 objek
// ============================================================
app.get('/api/latest-data', (req, res) => {
    const queryTemp = `
        SELECT temperature, voltage_temp, valve_percent, send_timestamp
        FROM sensor_temperature
        ORDER BY id DESC LIMIT 1
    `;
    const queryPres = `
        SELECT pressure, voltage_pressure, sv1_status, sv2_status,
               buzzer_status, shutdown_active, send_timestamp AS pressure_timestamp
        FROM sensor_pressure
        ORDER BY id DESC LIMIT 1
    `;

    db.query(queryTemp, (errT, resT) => {
        if (errT) return res.status(500).json({ error: errT.message });

        db.query(queryPres, (errP, resP) => {
            if (errP) return res.status(500).json({ error: errP.message });

            // Gabungkan data temperature + pressure ke 1 objek
            const combined = {
                ...(resT[0] || {}),
                ...(resP[0] || {}),
            };
            res.json(combined);
        });
    });
});

// ============================================================
// 5. API: POST /api/control/setpoint/:param
//    Terima setpoint dari frontend → publish ke ESP32 via MQTT
//    FIX #7: Endpoint missing di backend lama
// ============================================================
app.post('/api/control/setpoint/:param', (req, res) => {
    const { param } = req.params;
    const { value }  = req.body;

    if (value === undefined || isNaN(parseFloat(value))) {
        return res.status(400).json({ success: false, message: 'Value tidak valid.' });
    }

    // Map parameter frontend → nama yang dibaca firmware
    const paramMap = {
        'temp':     'temp',
        'kp':       'kp',
        'sampling': 'sampling',
    };

    const mqttParam = paramMap[param];
    if (!mqttParam) {
        return res.status(400).json({ success: false, message: `Parameter '${param}' tidak dikenal.` });
    }

    const payload = JSON.stringify({ parameter: mqttParam, value: parseFloat(value) });
    mqttClient.publish(TOPIC_CONTROL, payload, { qos: 1 }, (err) => {
        if (err) {
            console.error('❌ Gagal publish setpoint:', err.message);
            return res.status(500).json({ success: false, message: 'Gagal kirim ke ESP32.' });
        }
        console.log(`📤 Setpoint dikirim → ${payload}`);
        res.json({ success: true, message: `Setpoint ${param} = ${value} berhasil dikirim ke ESP32.` });
    });
});

// ============================================================
// 6. API: POST /api/control/pressure-limit/:param
//    Setpoint batas tekanan → publish ke SIS via MQTT
//    FIX #8: Endpoint missing di backend lama
// ============================================================
app.post('/api/control/pressure-limit/:param', (req, res) => {
    const { param } = req.params;
    const { value }  = req.body;

    if (value === undefined || isNaN(parseFloat(value))) {
        return res.status(400).json({ success: false, message: 'Value tidak valid.' });
    }

    const paramMap = {
        'pressure':          'pressure_pahh',
        'pressure-sampling': 'sampling',
    };

    const mqttParam = paramMap[param];
    if (!mqttParam) {
        return res.status(400).json({ success: false, message: `Parameter '${param}' tidak dikenal.` });
    }

    const payload = JSON.stringify({ parameter: mqttParam, value: parseFloat(value) });
    mqttClient.publish(TOPIC_CONTROL, payload, { qos: 1 }, (err) => {
        if (err) {
            console.error('❌ Gagal publish pressure limit:', err.message);
            return res.status(500).json({ success: false, message: 'Gagal kirim ke ESP32 SIS.' });
        }
        console.log(`📤 Pressure limit dikirim → ${payload}`);
        res.json({ success: true, message: `Batas tekanan ${param} = ${value} Bar berhasil dikirim ke ESP32 SIS.` });
    });
});

// ============================================================
// 7. API: POST /api/sis-control
//    Terima perintah SIS ON/OFF dari frontend
//    FIX #9: Endpoint missing di backend lama
// ============================================================
app.post('/api/sis-control', (req, res) => {
    const { command, status, timestamp } = req.body;
    console.log(`⚡ SIS Control: command=${command}, status=${status}, time=${timestamp}`);
    // Bisa di-extend: simpan ke DB log atau publish MQTT command khusus
    res.json({ success: true, message: `SIS command diterima: ${status}` });
});

// ============================================================
// 8. API: GET /api/export/temperature-log
//    Export CSV data suhu (dengan filter waktu opsional)
//    FIX #10: Endpoint missing di backend lama
// ============================================================
app.get('/api/export/temperature-log', (req, res) => {
    const { start, end } = req.query;

    let query  = 'SELECT * FROM sensor_temperature';
    const vals = [];

    if (start && end) {
        query += ' WHERE receive_timestamp BETWEEN ? AND ?';
        vals.push(start, end);
    }

    query += ' ORDER BY id ASC LIMIT 500';

    db.query(query, vals, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!results.length) return res.status(200).send('');

        // Build CSV
        const headers = Object.keys(results[0]).join(',');
        const rows    = results.map(r => Object.values(r).join(','));
        const csv     = [headers, ...rows].join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="temperature_log.csv"');
        res.send(csv);
    });
});

// ============================================================
// 9. API: GET /api/export/pressure-log
//    Export CSV data tekanan (dengan filter waktu opsional)
//    FIX #11: Endpoint missing di backend lama
// ============================================================
app.get('/api/export/pressure-log', (req, res) => {
    const { start, end } = req.query;

    let query  = 'SELECT * FROM sensor_pressure';
    const vals = [];

    if (start && end) {
        query += ' WHERE receive_timestamp BETWEEN ? AND ?';
        vals.push(start, end);
    }

    query += ' ORDER BY id ASC LIMIT 500';

    db.query(query, vals, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!results.length) return res.status(200).send('');

        const headers = Object.keys(results[0]).join(',');
        const rows    = results.map(r => Object.values(r).join(','));
        const csv     = [headers, ...rows].join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="pressure_log.csv"');
        res.send(csv);
    });
});

// ============================================================
// 10. Fallback: semua route lain → index.html (SPA support)
// ============================================================
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// ============================================================
// START SERVER
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🏰 Backend berjalan di http://localhost:${PORT}`);
});
