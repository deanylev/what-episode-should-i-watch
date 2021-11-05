import { randomInt } from 'crypto';
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

app.get('/shows', async (req, res) => {
  const { q } = req.query;
  const trimmedQuery = typeof q === 'string' ? q.trim() : '';
  if (!trimmedQuery) {
    res.sendStatus(400);
    return;
  }

  try {
    const { Response, Search } = await omdbQuery({ s: trimmedQuery });
    if (Response !== 'True') {
      res.json([]);
      return;
    }

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
      q,
      error
    });
    res.sendStatus(500);
  }
});

app.get('/episode/:imdbId', async (req, res) => {
  const { imdbId } = req.params;

  try {
    const { Response, totalSeasons } = await omdbQuery({ i: imdbId });
    if (Response !== 'True') {
      res.sendStatus(404);
      return;
    }

    const parsedTotalSeasons = parseInt(totalSeasons, 10) || 1;
    const { seasonMax, seasonMin } = req.query;
    const parsedSeasonMin = typeof seasonMin === 'string' ? (parseInt(seasonMin, 10) || 1) : 1;
    const parsedSeasonMax = typeof seasonMax === 'string' ? (parseInt(seasonMax, 10) || parsedTotalSeasons) : parsedTotalSeasons;
    const seasonStart = Math.min(Math.max(1, parsedSeasonMin), parsedTotalSeasons);
    const seasonEnd = Math.max(Math.min(parsedSeasonMax, parsedTotalSeasons), seasonStart);

    let Plot, Poster, Title, episode, season;

    for (let i = 0; i < LOOKUP_ATTEMPTS; i++) {
      season = await promisify<number, number, number>(randomInt)(seasonStart, seasonEnd + 1);
      const { Episodes } = await omdbQuery({ i: imdbId, season });
      const numEpisodes = Episodes?.length ?? 1;
      episode = await promisify<number, number, number>(randomInt)(1, numEpisodes + 1);

      ({ Plot, Poster, Title } = await omdbQuery({ i: imdbId, episode, season }));

      // some listings are missing these for some reason
      // if so, keep trying and eventually give up
      if (Plot && Title || numEpisodes === 1) {
        break;
      }
    }

    res.json({
      episode,
      plot: Plot,
      posterUrl: Poster === 'N/A' ? null : Poster,
      season,
      title: Title,
      totalSeasons: parsedTotalSeasons
    });
  } catch (error) {
    console.error('error while querying show', {
      imdbId,
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
