const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

const router = express.Router();

const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
dayjs.extend(customParseFormat);

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
        departure = "", status = "", arrival = ""
      ] = values;

      const normalizedId = aircraftId.replace(/-/g, '').toUpperCase();

      if (!aircraft || normalizedId.includes(aircraft)) {

        const duration = calcularDuracaoVoo(departure, arrival);

        if (aircraftId) {
          flights.push({
            aircraftId: normalizedId,
            aircraftType,
            destination,
            departure,
            arrival,
            duration,
            status,
          });
        }
      }
    });

    return { source: url, data: flights };

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
        status,
      });
    });

    return {
      source: url,
      data: unificarVoosOffshore(flights)
    };

  } catch (error) {
    console.error('Erro ao buscar dados do histórico da aeronave:', error);
    return { error: "Erro ao buscar dados do histórico da aeronave." };
  }
}


function unificarVoosOffshore(flights) {
  flights = flights.reverse()

  const resultado = [];
  let vooUnificado = {}

  for (let i = 0; i < flights.length; i++) {
    const vooAtual = flights[i];
    if (!vooAtual.origin) { continue }

    const decolouDeAeroporto = vooAtual.origin && !vooAtual.origin.includes("Near");
    const pousouEmAeroporto = vooAtual.destination && !vooAtual.destination.includes("Near") && !vooAtual.destination.includes("Plataforma")

    vooAtual.departure = vooAtual.departure.replace("First seen ", "")
    vooAtual.arrival = vooAtual.arrival.replace("Last seen ", "")

    if (vooAtual.duration == "En Route") {
      resultado.push(vooAtual)
      continue;
    }

    if (decolouDeAeroporto && pousouEmAeroporto) {
      resultado.push(vooAtual);
      continue;
    }

    if (decolouDeAeroporto) {
      vooUnificado = vooAtual
      continue;
    }

    if (!decolouDeAeroporto && !pousouEmAeroporto) {
      continue;
    }

    if (pousouEmAeroporto && vooUnificado.origin) {
      vooUnificado.destination = vooAtual.destination
      vooUnificado.arrival = vooAtual.arrival
      vooUnificado.duration = calcularDuracaoVoo(vooUnificado.departure, vooAtual.arrival, vooUnificado.date)
      vooUnificado.status = vooAtual.status
      resultado.push(vooUnificado);
      vooUnificado = {}
      continue;
    }

    resultado.push(vooAtual);
  }

  return resultado.reverse()
}

/**
 * Calcula a duração do voo baseado em departure e arrival
 * @param {string} departure - Ex: "09:45AM -03"
 * @param {string} arrival - Ex: "11:07AM -03"
 * @param {string} date - Ex: "23-Jul-2025" (opcional, default = hoje)
 * @returns {string} duração no formato "H:MM"
 */

function calcularDuracaoVoo(departure, arrival, date = dayjs().format('DD-MMM-YYYY')) {
  const formato = 'DD-MMM-YYYY hh:mma ZZ';

  if (!arrival || /unknown/i.test(arrival)) {
    return "";
  }

  if (/en route/i.test(arrival)) {
    return "En Route";
  }

  const partida = dayjs(`${date} ${departure}`, formato);
  const chegada = dayjs(`${date} ${arrival}`, formato);

  // Se chegada for antes da partida, considera que cruzou a meia-noite
  const chegadaCorrigida = chegada.isBefore(partida) ? chegada.add(1, 'day') : chegada;

  const minutos = chegadaCorrigida.diff(partida, 'minute');
  const horas = Math.floor(minutos / 60);
  const minutosRestantes = String(minutos % 60).padStart(2, '0');

  return `${horas}:${minutosRestantes}`;
}

module.exports = router;
