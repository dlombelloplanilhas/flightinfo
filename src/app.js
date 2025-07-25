const express = require('express');
const flightsRouter = require('./routes/flights');
const cors = require('cors');

const app = express();
app.use(cors());

// Middleware global (opcional)
app.use(express.json());

// Rotas
app.use('/flights', flightsRouter);

// Rota de boas-vindas
app.get('/', (req, res) => {
  res.status(400).json({
    error: "Você deve informar pelo menos o parâmetro 'airport' ou 'aircraft'.",
    exemple: 'https://flightinfo.onrender.com/flights?airport=SBME&aircraft=PROHR'
  });
});

module.exports = app;
