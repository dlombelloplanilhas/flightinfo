const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = 3000;

app.get('/flights', async (req, res) => {
  const { airport, aircraft } = req.query;

  if (!airport) {
    return res.status(400).json({ error: "Parâmetro 'airport' é obrigatório." });
  }

  try {
    const url = `https://www.flightaware.com/live/airport/${airport}`;
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);

    const departuresSection = $('#departures-board');
    if (!departuresSection.length) {
      return res.status(404).json({ error: "Seção 'Departures' não encontrada." });
    }

    const table = departuresSection.find('table').first();
    const voos = [];

    table.find('tr').slice(1).each((i, tr) => {
      const tds = $(tr).find('td');

      const values = tds.map((i, td) => $(td).text().trim().replace(/\s+/g, ' ')).get();

      const voo = {
        flightNumber: values[0] || "",
        aircraftType: values[1] || "",
        destination: values[2] || "",
        departureTime: values[3] || "",
        status: values[4] || "",
        arrivalTime: values[5] || ""
      };

      if (!aircraft || voo.flightNumber.includes(aircraft.toUpperCase())) {
        voos.push(voo);
      }
    });

    res.json(voos.length ? voos : { message: "Nenhum voo encontrado com os critérios." });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao buscar dados do FlightAware." });
  }
});

app.listen(PORT, () => {
  console.log(`API rodando em http://localhost:${PORT}/flights?airport=SBME`);
});
