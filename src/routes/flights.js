const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

const router = express.Router();

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const customParseFormat = require('dayjs/plugin/customParseFormat');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(customParseFormat);
dayjs.extend(timezone);


const axiosHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/91.0.4472.124 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
};

router.get('/', async (req, res) => {
  const { airport, aircraft } = req.query;

  if (!airport && !aircraft) {
    return res.status(400).json({
      error: "Você deve informar pelo menos o parâmetro 'airport' ou 'aircraft'.",
      example: 'https://flightinfo.onrender.com/flights?airport=SBME,SBVT&aircraft=PROHR,PSCDU'
    });
  }

  try {
    const airports = airport ? airport.split(' ').join('').split(',') : [];
    const aircrafts = aircraft ? aircraft.split(' ').join('').split(',') : [];

    // Chama todos os getByAirport em paralelo
    const airportResults = await Promise.all(
      airports.map(ap => getByAirport(ap, aircrafts))
    );

    // Chama todos os getByAircraft em paralelo
    const aircraftResults = await Promise.all(
      aircrafts.map(async ac => {
        if (ac && ac.length === 3) {
          for (const prefix of ['PR', 'PS', 'PP']) {
            let aircraftId = (prefix + ac).trim().toUpperCase().replace('-', '');
            try {
              const res = await getByAircraft(aircraftId);
              if (res?.data && res.data.length > 0) {
                return res;
              }
            } catch (error) {
              console.log(`Tentativa com ${prefix}${ac} falhou:`, error.message);
            }
          }
        } else {
          let aircraftId = ac.trim().toUpperCase().replace('-', '');
          try {
            const res = await getByAircraft(aircraftId);
            if (res?.data && res.data.length > 0) {
              return res;
            }
          } catch (error) {
            console.log(`Tentativa com ${prefix}${ac} falhou:`, error.message);
          }
        }
        // Retorna um objeto vazio se não encontrou nada
        return { data: [], source: null, error: null };
      })
    );

    // Unifica os dados válidos - CORREÇÃO PRINCIPAL AQUI
    const data = [
      ...airportResults.flatMap(r => r?.data || []), // Remove .length
      ...aircraftResults.flatMap(r => r?.data || []) // Remove .length
    ];

    const source = [
      ...airportResults.map(r => r?.source).filter(Boolean),
      ...aircraftResults.map(r => r?.source).filter(Boolean)
    ];

    const error = [
      ...airportResults.map(r => r?.error).filter(Boolean),
      ...aircraftResults.map(r => r?.error).filter(Boolean)
    ];

    // Ordena por data e horário
    const dadosOrdenados = data.sort((a, b) => {
      let dataStrA = `${a.date} ${a.departure}`;
      let dataStrB = `${b.date} ${b.departure}`;
      return dataStrB.localeCompare(dataStrA);
    });

    res.json({ error, total: dadosOrdenados.length, source, data: dadosOrdenados });

  } catch (error) {
    console.error('Erro geral:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

async function getByAirport(airport) {
  try {
    const url = `https://www.flightaware.com/live/airport/${airport}`;
    const response = await axios.get(url, { headers: axiosHeaders });
    const $ = cheerio.load(response.data);

    const departuresSection = $('#departures-board');
    if (!departuresSection.length) {
      return { error: `Seção 'Departures' de ${airport} não encontrada.` };
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

      departure = formatTime(departure)
      arrival = formatTime(arrival)

      const duration = calcularDuracaoVoo(departure, arrival);

      if (aircraftId) {
        flights.push({
          date: getDataPorHorarioUTC(departure),
          aircraftId: normalizedId,
          aircraftType,
          origin: airport,
          destination,
          departure,
          arrival,
          duration,
          status,
        });
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
      return { error: `Tabela de histórico de ${aircraft} não encontrada.` };
    }

    table.find('tr').slice(1).each((_, tr) => {
      const tds = $(tr).find('td');
      const values = tds.map((_, td) => $(td).text().trim().replace(/\s+/g, ' ')).get();

      let [
        date = "", aircraftType = "", origin = "", destination = "",
        departure = "", arrival = "", duration = "", status = ""
      ] = values;

      if (departure) {
        departure = formatTime(departure)
        arrival = formatTime(arrival)
        date = formatDateToDefault(date)

        flights.push({
          date,
          aircraftId: aircraft,
          aircraftType,
          origin,
          destination,
          departure,
          arrival,
          duration,
          status,
        });
      }
    });

    if (flights.length) {
      return {
        source: url,
        data: unificarVoosOffshore(flights)
      };
    } else {
      return { error: `Tabela de histórico de ${aircraft} não encontrada.` };
    }


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
      (vooAtual.duration > '1:00')
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

  // Separar horário e offset
  const [departureTime, departureOffset] = departure.split(/ ([-+]\d{2})$/).filter(Boolean);
  const [arrivalTime, arrivalOffset] = arrival.split(/ ([-+]\d{2})$/).filter(Boolean);

  // Converter para formato 24h
  const departureTime24h = (departureTime);
  const arrivalTime24h = (arrivalTime);

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

function formatTime(horaStr) {
  if (!horaStr.includes(':')) return '';

  horaStr = horaStr.replace(/First seen\s+/i, '')
    .replace(/Last seen\s+/i, '')
    .replace(/\(\?\)/g, '')
    .trim();

  return horaStr.replace(/(\d{1,2}):(\d{2})\s*([ap]m?|[AP]M?)/g, (_, h, m, p) => {
    const meridiano = p.toUpperCase().startsWith('A') ? 'AM' : 'PM';
    return formatTimeTo24h(`${h}:${m}${meridiano}`);
  });
}

function formatTimeTo24h(timeStr) {
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

function formatDateToDefault(dataStr) {
  const meses = {
    // Inglês
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    // Português
    jan: '01', fev: '02', mar: '03', abr: '04', mai: '05', jun: '06',
    jul: '07', ago: '08', set: '09', out: '10', nov: '11', dez: '12'
  };

  const regex = /^(\d{1,2})[-\/\s]([a-zA-Z]{3})[-\/\s](\d{4})$/;

  const match = dataStr.trim().match(regex);
  if (!match) {
    console.error('Formato de data inválido:', dataStr);
    return null;
  }

  let [_, dia, mesAbrev, ano] = match;
  dia = dia.padStart(2, '0');
  const mesNum = meses[mesAbrev.toLowerCase()];

  if (!mesNum) {
    console.error('Mês não reconhecido:', mesAbrev);
    return null;
  }

  return `${ano}-${mesNum}-${dia}`;
}

function getDataPorHorarioUTC(departure) {
  // Parse do formato "14:20PM -3"
  const regex = /(\d{1,2}):(\d{2})(AM|PM)?\s*(-?\d+)/;
  const match = departure.match(regex);

  if (!match) {
    throw new Error('Formato inválido. Use formato como "14:20PM -3" ou "14:20 -3"');
  }

  let [_, horaStr, minutoStr, periodo, offsetStr] = match;
  let hora = parseInt(horaStr, 10);
  const minuto = parseInt(minutoStr, 10);
  const offset = parseInt(offsetStr, 10);

  // Ajusta hora se for formato 12h (AM/PM)
  if (periodo) {
    if (periodo === 'PM' && hora !== 12) {
      hora += 12;
    } else if (periodo === 'AM' && hora === 12) {
      hora = 0;
    }
  }

  // Cria horário atual em UTC
  const agoraUTC = dayjs.utc();

  // Cria horário de partida considerando o offset
  // Se o offset é -3, significa que para converter para UTC precisamos somar 3 horas
  const departureLocal = dayjs().hour(hora).minute(minuto).second(0).millisecond(0);
  const departureUTC = departureLocal.subtract(offset, 'hour');

  // Compara os horários em UTC
  let dataResultado;

  if (departureUTC.isAfter(agoraUTC)) {
    // Se o horário de partida é maior que agora → usar data de ontem
    dataResultado = agoraUTC.subtract(1, 'day');
  } else {
    // Se o horário de partida é menor ou igual → usar data de hoje
    dataResultado = agoraUTC;
  }

  // Retorna no formato YYYY-MM-DD
  return dataResultado.format('YYYY-MM-DD');
}

module.exports = router;
