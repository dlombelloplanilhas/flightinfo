const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = 3000;

app.listen(PORT, () => {
  console.log(`API rodando em http://localhost:${PORT}/flights?airport=SBME`);
});

app.get('/', async (req, res) => {
  const { airport, aircraft } = req.query;
  let result = { exemple: 'https://flightinfo.onrender.com/flights?airport=SBME&aircraft=PROHR' };
  res.json(result);
});

app.get('/flights', async (req, res) => {
  const { airport, aircraft } = req.query;
  let result = { exemple: 'https://flightinfo.onrender.com/flights?airport=SBME&aircraft=PROHR' };

  try {
    if (airport) {
      result = await getByAirport(airport, aircraft);
    } else if (aircraft) {
      result = await getByAircraft(aircraft);
    }

    res.json(result);
  } catch (error) {
    console.error('Erro geral:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

async function getByAirport(airport, aircraft) {
  aircraft = aircraft ? aircraft.replace(/-/g, '').toUpperCase() : undefined;

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
      return { error: "Seção 'Departures' não encontrada." };
    }

    const table = departuresSection.find('table').first();
    const voos = [];

    table.find('tr').slice(1).each((i, tr) => {
      const tds = $(tr).find('td');

      const values = tds.map((i, td) => $(td).text().trim().replace(/\s+/g, ' ')).get();

      const voo = {
        aircraftId: values[0] ? values[0].replace(/-/g, '').toUpperCase() : "",
        aircraftType: values[1] || "",
        destination: values[2] || "",
        departureTime: values[3] || "",
        status: values[4] || "",
        arrivalTime: values[5] || ""
      };

      if (!aircraft || voo.aircraftId.toUpperCase().includes(aircraft.toUpperCase())) {
        voos.push(voo);
      }
    });

    return voos;
  } catch (error) {
    console.error('Erro ao buscar dados do FlightAware:', error);
    return { error: "Erro ao buscar dados do FlightAware." };
  }
}

async function getByAircraft(aircraft) {
  aircraft = aircraft ? aircraft.replace(/-/g, '').toUpperCase() : undefined;

  try {
    const url = `https://www.flightaware.com/live/flight/${aircraft}/history`;

    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/91.0.4472.124 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      }
    });

    const $ = cheerio.load(response.data);

    const table = $('table.prettyTable').first();
    const flights = [];

    if (!table.length) {
      return { error: "Tabela de histórico não encontrada." };
    }

    table.find('tr').slice(1).each((i, tr) => {
      const tds = $(tr).find('td');

      const values = tds.map((i, td) => $(td).text().trim().replace(/\s+/g, ' ')).get();

      const flight = {
        date: values[0] || "",
        aircraftType: values[1] || "",
        origin: values[2] || "",
        destination: values[3] || "",
        departure: values[4] || "",
        arrival: values[5] || "",
        duration: values[6] || "",
        status: values[7] || ""
      };

      flights.push(flight);
    });

    return flights;
  } catch (error) {
    console.error('Erro ao buscar dados do histórico da aeronave:', error);
    return { error: "Erro ao buscar dados do histórico da aeronave." };
  }
}



