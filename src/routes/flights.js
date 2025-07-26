const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

const router = express.Router();

const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
const utc = require('dayjs/plugin/utc');

dayjs.extend(customParseFormat);
dayjs.extend(utc);

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

      let [
        aircraftId = "", aircraftType = "", destination = "",
        departure = "", status = "", arrival = ""
      ] = values;

      const normalizedId = aircraftId.replace(/-/g, '').toUpperCase();

      if (!aircraft || normalizedId.includes(aircraft)) {

        departure = formatarHora(departure)
        arrival = formatarHora(arrival)

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

    function isAeroporto(valor) {
      if (!valor) return false;
      const texto = valor.toLowerCase();
      return !texto.includes("near") && !texto.includes("plataforma");
    }

    const decolouDeAeroporto = isAeroporto(vooAtual.origin);
    const pousouEmAeroporto = isAeroporto(vooAtual.destination);

    vooAtual.departure = vooAtual.departure.replace("First seen ", "").replace("(?)", "").trim()
    vooAtual.arrival = vooAtual.arrival.replace("Last seen ", "").replace("(?)", "").trim()

    if (decolouDeAeroporto && vooUnificado.origin) {
      resultado.push(vooUnificado);
      vooUnificado = {}
    }

    if (vooUnificado.origin && (vooAtual.date != vooUnificado.date)) {
      resultado.push(vooUnificado);
      vooUnificado = {}
    }

    if (
      (vooAtual.duration == "En Route") ||
      (decolouDeAeroporto && pousouEmAeroporto) ||
      (!decolouDeAeroporto && vooAtual.duration > '1:00')
    ) {
      resultado.push(vooAtual);
      continue;
    }

    if (
      (decolouDeAeroporto) ||
      (!decolouDeAeroporto && !vooUnificado.origin)
    ) {
      vooUnificado = vooAtual
      continue;
    }

    if (!pousouEmAeroporto && vooUnificado.origin) {
      vooUnificado.destination = vooAtual.destination
      vooUnificado.arrival = vooAtual.arrival
      vooUnificado.duration = calcularDuracaoVoo(vooUnificado.departure, vooAtual.arrival)
      vooUnificado.status = vooAtual.status
      continue;
    }

    if (pousouEmAeroporto && vooUnificado.origin) {
      vooUnificado.destination = vooAtual.destination
      vooUnificado.arrival = vooAtual.arrival
      vooUnificado.duration = calcularDuracaoVoo(vooUnificado.departure, vooAtual.arrival)
      vooUnificado.status = vooAtual.status
      resultado.push(vooUnificado);
      vooUnificado = {}
      continue;
    }

    resultado.push(vooAtual);
  }

  return resultado.reverse()
}


function calcularDuracaoVoo(departure, arrival, date = dayjs().format('DD-MMM-YYYY')) {
  if (!arrival || /unknown/i.test(arrival)) {
    return "";
  }

  if (/en route/i.test(arrival)) {
    return "En Route";
  }

  // Função para converter AM/PM para 24h
  function convertTo24h(timeStr) {
    const [time, period] = timeStr.split(/([AP]M)/i);
    const [hours, minutes] = time.split(':');
    let hour24 = parseInt(hours);

    if (period?.toUpperCase() === 'PM' && hour24 !== 12) {
      hour24 += 12;
    } else if (period?.toUpperCase() === 'AM' && hour24 === 12) {
      hour24 = 0;
    }

    return `${hour24.toString().padStart(2, '0')}:${minutes}`;
  }

  // Separar horário e offset
  const [departureTime, departureOffset] = departure.split(/ ([-+]\d{2})$/).filter(Boolean);
  const [arrivalTime, arrivalOffset] = arrival.split(/ ([-+]\d{2})$/).filter(Boolean);

  // Converter para formato 24h
  const departureTime24h = convertTo24h(departureTime);
  const arrivalTime24h = convertTo24h(arrivalTime);

  const offsetDep = parseInt(departureOffset) || 0;
  const offsetArr = parseInt(arrivalOffset) || 0;

  // Criar datetimes em UTC usando formato 24h
  const formato24h = 'DD-MMM-YYYY HH:mm';
  let partidaUTC = dayjs.utc(`${date} ${departureTime24h}`, formato24h).subtract(offsetDep, 'hour');
  let chegadaUTC = dayjs.utc(`${date} ${arrivalTime24h}`, formato24h).subtract(offsetArr, 'hour');

  // Se a chegada UTC for antes da partida UTC, adiciona 1 dia
  if (chegadaUTC.isBefore(partidaUTC)) {
    chegadaUTC = chegadaUTC.add(1, 'day');
  }

  const duracaoMin = chegadaUTC.diff(partidaUTC, 'minute');
  const horas = Math.floor(duracaoMin / 60);
  const minutos = String(duracaoMin % 60).padStart(2, '0');

  return `${horas}:${minutos}`;
}

function formatarHora(horaStr) {
  return horaStr.replace(/(\d{1,2}:\d{2})([ap])\s*(-?\d{2})/i, (_, hora, meridiano, tz) => {
    const periodo = meridiano.toUpperCase() === 'A' ? 'AM' : 'PM';
    return `${hora}${periodo} ${tz}`;
  });
}

module.exports = router;
