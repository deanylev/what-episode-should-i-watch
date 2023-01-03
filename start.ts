import { randomBytes, randomInt } from 'crypto';
import { AddressInfo } from 'net';
import { promisify } from 'util';

import cors from 'cors';
import express from 'express';
import MovieDB from 'node-themoviedb';

const { NODE_ENV, PORT, TMDB_API_KEY } = process.env;

if (!TMDB_API_KEY) {
  console.error('Error: missing TMDB API key');
  process.exit(1);
}

const mdb = new MovieDB(TMDB_API_KEY);

const app = express();

if (NODE_ENV !== 'production') {
  app.use(cors());
}

app.use(express.static('frontend/build'));

const generateId = async () => {
  const buffer = await promisify(randomBytes)(5);
  return buffer.toString('hex');
};

const constructImageUrl = (path: string) => {
  return `https://image.tmdb.org/t/p/original/${path}`;
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
    const { data: { results } } = await mdb.search.TVShows({
      query: {
        query: trimmedQuery
      }
    });

    console.log('show results', {
      requestId,
      amount: results.length
    });

    res.json(results.map(({ first_air_date, id, name, poster_path }) => {
      return {
        id,
        posterUrl: poster_path && constructImageUrl(poster_path),
        title: name,
        yearStart: first_air_date && first_air_date.split('-')[0] || 'Unknown Year'
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

app.get('/episode/:id', async (req, res) => {
  const { id } = req.params;

  const requestId = await generateId();
  console.log('querying show', {
    requestId,
    id,
    ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress
  });

  try {
    const { data: { last_air_date, next_episode_to_air, number_of_seasons, seasons } } = await mdb.tv.getDetails({
      pathParameters: {
        tv_id: id
      }
    });

    const { history, seasonMax, seasonMin } = req.query;
    const parsedSeasonMin = typeof seasonMin === 'string' ? (parseInt(seasonMin, 10) || 1) : 1;
    const parsedSeasonMax = typeof seasonMax === 'string' ? (parseInt(seasonMax, 10) || number_of_seasons) : number_of_seasons;
    const seasonStart = Math.min(Math.max(1, parsedSeasonMin), number_of_seasons);
    const seasonEnd = Math.max(Math.min(parsedSeasonMax, number_of_seasons), seasonStart);

    let parsedHistory: [number, number][] = [];
    try {
      parsedHistory = JSON.parse(history as string);

      if (parsedHistory.some((element) => !Array.isArray(element) || element.length !== 2 || element.some((subElement) => typeof subElement !== 'number'))) {
        parsedHistory = [];
      }
    } catch {
      // swallow
    }

    const season = await promisify<number, number, number>(randomInt)(seasonStart, seasonEnd + 1);
    const numEpisodes = seasons.find(({ season_number }) => season_number === season)?.episode_count ?? 1;
    const episodeHistory = parsedHistory.filter(([historySeason]) => historySeason === season).map(([historySeason, historyEpisode]) => historyEpisode);

    let episode;
    do {
      episode = await promisify<number, number, number>(randomInt)(1, numEpisodes + 1);
    } while (episodeHistory.length < numEpisodes ? episodeHistory.includes(episode) : episode === episodeHistory[episodeHistory.length - 1]);

    const { data: { name, overview, still_path, vote_average } } = await mdb.tv.episode.getDetails({
      pathParameters: {
        tv_id: id,
        season_number: season,
        episode_number: episode
      }
    });

    console.log('show result', {
      requestId,
      season,
      episode
    });

    res.json({
      episode,
      plot: overview,
      posterUrl: still_path && constructImageUrl(still_path),
      rating: vote_average.toFixed(1),
      season,
      showYearEnd: next_episode_to_air ? null : last_air_date.split('-')[0],
      title: name,
      totalSeasons: number_of_seasons
    });
  } catch (error) {
    if ((error as { errorCode: number; }).errorCode === 404) {
      console.warn('show not found', {
        requestId
      });
      res.sendStatus(404);
      return;
    }

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
