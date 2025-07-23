const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

const router = express.Router();

const axiosHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/91.0.4472.124 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
};

// GET /flights?airport=SBME&aircraft=PROHR
router.get('/', async (req, res) => {
  const { airport, aircraft } = req.query;

  if (!airport && !aircraft) {
    return res.status(400).json({
      error: "Você deve informar pelo menos o parâmetro 'airport' ou 'aircraft'.",
      exemple: 'https://flightinfo.onrender.com/flights?airport=SBME&aircraft=PROHR'
    });
  }

  try {
    let result;

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

// ------------------------------
// Funções auxiliares de scraping
// ------------------------------

async function getByAirport(airport, aircraft) {
  aircraft = aircraft ? aircraft.replace(/-/g, '').toUpperCase() : undefined;

  try {
    const url = `https://www.flightaware.com/live/airport/${airport}`;
    const response = await axios.get(url, { headers: axiosHeaders });
    const $ = cheerio.load(response.data);

    const departuresSection = $('#departures-board');
    if (!departuresSection.length) {
      return { error: "Seção 'Departures' não encontrada." };
    }

    const table = departuresSection.find('table').first();
    const flights = [];

    table.find('tr').slice(1).each((_, tr) => {
      const tds = $(tr).find('td');
      const values = tds.map((_, td) => $(td).text().trim().replace(/\s+/g, ' ')).get();

      const [
        aircraftId = "", aircraftType = "", destination = "",
        departureTime = "", status = "", arrivalTime = ""
      ] = values;

      const normalizedId = aircraftId.replace(/-/g, '').toUpperCase();

      if (!aircraft || normalizedId.includes(aircraft)) {
        flights.push({
          aircraftId: normalizedId,
          aircraftType,
          destination,
          departureTime,
          status,
          arrivalTime
        });
      }
    });

    return flights;
  } catch (error) {
    console.error('Erro ao buscar dados do aeroporto:', error);
    return { error: "Erro ao buscar dados do FlightAware." };
  }
}

async function getByAircraft(aircraft) {
  aircraft = aircraft ? aircraft.replace(/-/g, '').toUpperCase() : undefined;

  try {
    const url = `https://www.flightaware.com/live/flight/${aircraft}/history`;
    const response = await axios.get(url, { headers: axiosHeaders });
    const $ = cheerio.load(response.data);

    const table = $('table.prettyTable').first();
    const flights = [];

    if (!table.length) {
      return { error: "Tabela de histórico não encontrada." };
    }

    table.find('tr').slice(1).each((_, tr) => {
      const tds = $(tr).find('td');
      const values = tds.map((_, td) => $(td).text().trim().replace(/\s+/g, ' ')).get();

      const [
        date = "", aircraftType = "", origin = "", destination = "",
        departure = "", arrival = "", duration = "", status = ""
      ] = values;

      flights.push({
        date,
        aircraftType,
        origin,
        destination,
        departure,
        arrival,
        duration,
        status
      });
    });

    return flights;
  } catch (error) {
    console.error('Erro ao buscar dados do histórico da aeronave:', error);
    return { error: "Erro ao buscar dados do histórico da aeronave." };
  }
}

module.exports = router;
