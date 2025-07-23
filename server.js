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

    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/91.0.4472.124 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      }
    });

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
        aircraftId: values[0] || "",
        aircraftType: values[1] || "",
        destination: values[2] || "",
        departureTime: values[3] || "",
        status: values[4] || "",
        arrivalTime: values[5] || ""
      };

      if (!aircraft || voo.aircraftId.includes(aircraft.toUpperCase())) {
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
