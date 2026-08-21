const express = require("express");
const cors = require("cors");
const db = require("./db");

const app = express();

app.use(cors());
app.use(express.json());

const agentes = {
    "PC-1": {
        id: "PC-1",
        url: "http://localhost:8082"
    }
};

app.get("/", (req, res) => {
    res.send("API Workrave funcionando");
});

const agentesRegistrados = {};
const estadosAgentes = {};
const estadisticasAgentes = {}; 

app.post("/api/agents/:id/heartbeat", (req, res) => {

    const agente = obtenerAgente(req.params.id);

    if (!agente) {
        return res.status(404).json({
            success: false,
            message: "Agente no encontrado"
        });
    }

    const { running } = req.body;

    estadosAgentes[agente.id] = {
        connected: true,
        running: !!running,
        lastSeen: Date.now()
    };

    if (agentesRegistrados[agente.id]) {
        agentesRegistrados[agente.id].connected = true;
        agentesRegistrados[agente.id].lastSeen = Date.now();
    }

    res.json({
        success: true
    });
});

app.post("/api/agents/:id/stats", (req, res) => {

    const agente = obtenerAgente(req.params.id);

    if (!agente) {
        return res.status(404).json({
            success: false,
            message: "Agente no encontrado"
        });
    }

    estadisticasAgentes[agente.id] = {
        stats: req.body.stats,
        lastSeen: Date.now()
    };

    if (agentesRegistrados[agente.id]) {
        agentesRegistrados[agente.id].connected = true;
        agentesRegistrados[agente.id].lastSeen = Date.now();
    }

    res.json({
        success: true
    });
});

function obtenerAgente(id) {
    return agentesRegistrados[id] || agentes[id];
}


app.post("/api/workrave", (req, res) => {

    const payload = req.body;

    console.log("DATOS RECIBIDOS");
    console.log(JSON.stringify(payload, null, 2));

    const username = payload.agent?.username;
    const computer = payload.agent?.computer;
    const breakType = payload.event?.type;
    const eventType = payload.event?.action;
    const eventTime = payload.event?.time;

    if (!username || !computer || !breakType || !eventType || !eventTime) {
        return res.status(400).json({
            success: false,
            message: "Faltan datos del evento"
        });
    }

    const sql = `
        INSERT INTO workrave_logs
        (
            username,
            computer,
            break_type,
            event_type,
            event_time,
            payload
        )
        VALUES (?, ?, ?, ?, ?, ?)
    `;

    const values = [
        username,
        computer,
        breakType,
        eventType,
        eventTime,
        JSON.stringify(payload)
    ];

    db.query(sql, values, (err, result) => {

        if (err) {
            console.error("Error guardando evento en MySQL:", err);

            return res.status(500).json({
                success: false,
                message: "Error guardando evento"
            });
        }

        console.log(
            "Evento guardado en MySQL. ID:",
            result.insertId
        );

        res.json({
            success: true,
            id: result.insertId
        });
    });
});


app.post("/api/agents/register", (req, res) => {

    const {
        agentId,
        hostname,
        tailscaleIp,
        port
    } = req.body;

    if (!agentId || !hostname || !tailscaleIp || !port) {

        return res.status(400).json({
            success: false,
            message: "Faltan datos del agente"
        });

    }

    agentesRegistrados[agentId] = {
        id: agentId,
        hostname: hostname,
        tailscaleIp: tailscaleIp,
        url: `http://${tailscaleIp}:${port}`,
        connected: true,
        lastSeen: Date.now()
    };

    console.log(
        `Agente registrado: ${agentId} | ${hostname} | ${tailscaleIp}`
    );

    res.json({
        success: true,
        message: "Agente registrado correctamente",
        agent: agentesRegistrados[agentId]
    });
});



app.get("/api/agents", (req, res) => {

    const todosLosAgentes = {
        ...agentes,
        ...agentesRegistrados
    };

    const resultado = [];

    for (const agente of Object.values(todosLosAgentes)) {

        const estado = estadosAgentes[agente.id];

        resultado.push({
            id: agente.id,
            hostname: agente.hostname || agente.id,
            url: agente.url,
            connected: estado ? estado.connected : false,
            workrave: estado ? estado.running : false
        });
    }

    res.json(resultado);
});


app.get("/api/agents/:id/status", async (req, res) => {

    const agente = obtenerAgente(req.params.id);

    if (!agente) {
        return res.status(404).json({
            success: false,
            message: "Agente no encontrado"
        });
    }

    try {

        const response = await fetch(
            `${agente.url}/api/workrave/status`
        );

        const data = await response.json();

        res.json({
            id: agente.id,
            connected: true,
            running: data.running
        });

    } catch (error) {

        res.status(503).json({
            id: agente.id,
            connected: false,
            running: false
        });
    }
});


app.get("/api/agents/:id/stats", (req, res) => {

    const agente = obtenerAgente(req.params.id);

    if (!agente) {
        return res.status(404).json({
            success: false,
            message: "Agente no encontrado"
        });
    }

    const estadisticas = estadisticasAgentes[agente.id];

    if (!estadisticas) {
        return res.status(503).json({
            success: false,
            message: "El agente todavía no ha enviado estadísticas"
        });
    }

    res.json({
        id: agente.id,
        connected: true,
        stats: estadisticas.stats
    });
});



app.post("/api/agents/:id/open", async (req, res) => {

    const agente = obtenerAgente(req.params.id);

    if (!agente) {
        return res.status(404).json({
            success: false,
            message: "Agente no encontrado"
        });
    }

    try {

        const response = await fetch(
            `${agente.url}/api/workrave/open`,
            {
                method: "POST"
            }
        );

        const data = await response.json();

        res.status(response.status).json(data);

    } catch (error) {

        console.error(
            `Error abriendo Workrave en ${agente.id}:`,
            error.message
        );

        res.status(503).json({
            success: false,
            message: "No se pudo comunicar con el agente"
        });
    }
});


app.post("/api/agents/:id/close", async (req, res) => {

    const agente = obtenerAgente(req.params.id);

    if (!agente) {
        return res.status(404).json({
            success: false,
            message: "Agente no encontrado"
        });
    }

    try {

        const response = await fetch(
            `${agente.url}/api/workrave/close`,
            {
                method: "POST"
            }
        );

        const data = await response.json();

        res.status(response.status).json(data);

    } catch (error) {

        console.error(
            `Error cerrando Workrave en ${agente.id}:`,
            error.message
        );

        res.status(503).json({
            success: false,
            message: "No se pudo comunicar con el agente"
        });
    }
});


const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Servidor iniciado en puerto ${PORT}`);
});