import { randomBytes, randomInt } from 'crypto';
import { AddressInfo } from 'net';
import { promisify } from 'util';

import axios from 'axios';
import cors from 'cors';
import express from 'express';

interface SearchResult {
  Poster: string;
  Title: string;
  Type: string;
  Year: string;
  imdbID: string;
}

const { NODE_ENV, OMDB_API_KEY, PORT } = process.env;

const LOOKUP_ATTEMPTS = 5;

if (!OMDB_API_KEY) {
  console.error('Error: missing OMDB API key');
  process.exit(1);
}

const app = express();

if (NODE_ENV !== 'production') {
  app.use(cors());
}

app.use(express.static('frontend/build'));

const omdbQuery = async (params: Record<string, string | number>) => {
  const { data } = await axios.get('http://www.omdbapi.com', {
    params: {
      apikey: OMDB_API_KEY,
      type: 'series',
      ...params
    },
    responseType: 'json'
  });
  return data;
};

const generateId = async () => {
  const buffer = await promisify(randomBytes)(5);
  return buffer.toString('hex');
};

app.get('/shows', async (req, res) => {
  const { q } = req.query;
  const trimmedQuery = typeof q === 'string' ? q.trim() : '';
  if (!trimmedQuery) {
    res.sendStatus(400);
    return;
  }

  const requestId = await generateId();
  console.log('querying shows', {
    requestId,
    trimmedQuery,
    ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress
  });

  try {
    const { Response, Search } = await omdbQuery({ s: trimmedQuery });
    if (Response !== 'True') {
      console.log('no show results', {
        requestId
      });
      res.json([]);
      return;
    }

    console.log('show results', {
      requestId,
      amount: Search.length
    });

    res.json(Search.map(({ Poster, Title, Year, imdbID }: SearchResult) => {
      const [yearStart, yearEnd] = Year.split('–'); // not a normal dash
      return {
        imdbId: imdbID,
        posterUrl: Poster === 'N/A' ? null : Poster,
        title: Title,
        yearEnd: yearEnd ? parseInt(yearEnd, 10) : null,
        yearStart: parseInt(yearStart, 10)
      };
    }));
  } catch (error) {
    console.error('error while querying shows', {
      requestId,
      error
    });
    res.sendStatus(500);
  }
});

app.get('/episode/:imdbId', async (req, res) => {
  const { imdbId } = req.params;

  const requestId = await generateId();
  console.log('querying show', {
    requestId,
    imdbId,
    ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress
  });

  try {
    const { Response, totalSeasons } = await omdbQuery({ i: imdbId });
    if (Response !== 'True') {
      console.warn('show not found', {
        requestId
      });
      res.sendStatus(404);
      return;
    }

    const parsedTotalSeasons = parseInt(totalSeasons, 10) || 1;
    const { history, seasonMax, seasonMin } = req.query;
    const parsedSeasonMin = typeof seasonMin === 'string' ? (parseInt(seasonMin, 10) || 1) : 1;
    const parsedSeasonMax = typeof seasonMax === 'string' ? (parseInt(seasonMax, 10) || parsedTotalSeasons) : parsedTotalSeasons;
    const seasonStart = Math.min(Math.max(1, parsedSeasonMin), parsedTotalSeasons);
    const seasonEnd = Math.max(Math.min(parsedSeasonMax, parsedTotalSeasons), seasonStart);

    let parsedHistory: [number, number][] = [];
    try {
      parsedHistory = JSON.parse(history as string);

      if (parsedHistory.some((element) => !Array.isArray(element) || element.length !== 2 || element.some((subElement) => typeof subElement !== 'number'))) {
        parsedHistory = [];
      }
    } catch {
      // swallow
    }

    let Plot, Poster, Title, episode, imdbID, imdbRating, season = -1;

    for (let i = 0; i < LOOKUP_ATTEMPTS; i++) {
      season = await promisify<number, number, number>(randomInt)(seasonStart, seasonEnd + 1);
      const { Episodes } = await omdbQuery({ i: imdbId, season });
      const numEpisodes = Episodes?.length ?? 1;
      const episodeHistory = parsedHistory.filter(([historySeason]) => historySeason === season).map(([historySeason, historyEpisode]) => historyEpisode);

      do {
        episode = await promisify<number, number, number>(randomInt)(1, numEpisodes + 1);
      } while (episodeHistory.length < numEpisodes ? episodeHistory.includes(episode) : episode === episodeHistory[episodeHistory.length - 1])

      ({ Plot = null, Poster = 'N/A', Title = null, imdbID = null, imdbRating = 'N/A' } = await omdbQuery({
        episode,
        i: imdbId,
        plot: 'full',
        season
      }));

      // some listings are missing these for some reason
      // if so, keep trying and eventually give up
      if (Plot && Title || numEpisodes === 1) {
        break;
      }
    }

    console.log('show result', {
      requestId,
      season,
      episode
    });

    res.json({
      episode,
      imdbId: imdbID,
      imdbRating: imdbRating === 'N/A' ? null : imdbRating,
      plot: Plot,
      posterUrl: Poster === 'N/A' ? null : Poster,
      season,
      title: Title,
      totalSeasons: parsedTotalSeasons
    });
  } catch (error) {
    console.error('error while querying show', {
      requestId,
      error
    });
    res.sendStatus(500);
  }
});

const server = app.listen(parseInt(PORT || '8080', 10), () => {
  const address = server.address() as AddressInfo;
  console.log('listening', {
    port: address.port
  });
});
