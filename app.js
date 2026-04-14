const mqtt = require('mqtt');

const mysql = require('mysql2');

const express = require('express');

const cors = require('cors');

const app = express();



app.use(cors());



// 1. Koneksi Database Lokal VPS

const db = mysql.createConnection({

    host: 'localhost',

    user: 'root', 

    password: '', 

    database: 'simulator_vps'

});



// 2. Koneksi ke Mosquitto Lokal

const client = mqtt.connect('mqtt://localhost', {

    username: 'user_auliazqi',

    password: '#Simulatoradmin123' // Gunakan password yang dibuat saat setup Mosquitto

});



client.on('connect', () => {

    console.log("✅Broker MQTT Already Connect!");

    client.subscribe('panci/data');

});



// 3. Menangkap Data MQTT & Simpan ke Tabel sensor_data

client.on('message', (topic, message) => {

    try {

        const d = JSON.parse(message.toString());

        

        // Query sesuai dengan struktur tabel MySQL database lama

        const query = `INSERT INTO sensor_data 

        (temperature, pressure, stepper_status,   voltage_temp, voltage_pressure, send_timestamp, receive_timestamp) 

        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`;



        const values = [

            d.temp, d.pres, d.stepper, d.v_temp, d.v_pres, d.s_time

        ];



        db.query(query, values, (err) => {

            if (err) console.log("❌ Error Save:", err);

            else console.log("🚀 Sensor Data Succesfull Save!");

        });

    } catch (e) {

        console.log("⚠️ Format data tidak sesuai JSON");

    }

});



// 4. API Endpoint untuk Dashboard (Ambil 1 data terakhir)

app.get('/api/monitoring', (req, res) => {

    db.query('SELECT * FROM sensor_data ORDER BY id DESC LIMIT 1', (err, results) => {



        if (err) res.status(500).send(err);

        else res.json(results[0]);

    });

});



const PORT = 3000;

app.listen(PORT, () => console.log(`🏰 Backend Berjalan di Port ${PORT}`));
